from datetime import timedelta
import os

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import Feedback, Heartbeat, Incident, Job, Release, WorkItem
from .policy import Blocked, ensure_running


def dispatch(job):
    if job.kind == "triage":
        from .feedback import triage

        triage(Feedback.objects.get(pk=job.payload["feedback_id"]))
        return True
    if job.kind == "build":
        from .builder import build

        return build(WorkItem.objects.get(pk=job.payload["work_id"]))
    if job.kind == "release":
        # A distinct process with release-only credentials consumes this queue.
        raise Blocked(
            "release_worker_required",
            "Run the separate trusted release controller with protected credentials.",
        )
    if job.kind == "marketing":
        from .marketing import create_carousel

        create_carousel()
        return True
    if job.kind == "publish":
        from .instagram import publish
        from .models import Carousel

        return publish(Carousel.objects.get(pk=job.payload["carousel_id"]))
    if job.kind == "measure":
        from .instagram import measure
        from .models import Publication

        measure(Publication.objects.get(pk=job.payload["publication_id"]))
        return True
    if job.kind == "operations":
        stale = Job.objects.filter(
            status="running", lease_until__lt=timezone.now() - timedelta(minutes=15)
        ).count()
        if stale:
            Incident.objects.get_or_create(
                kind=f"stale_jobs:{timezone.now():%Y-%m-%d-%H}",
                defaults={
                    "summary": "Company jobs exceeded their lease. Fixed attempt limits and operator review apply.",
                    "evidence": {"count": stale},
                },
            )
        return True
    raise Blocked("unsupported_job", "The job type has no approved handler.")


def process_job(job_id, release_worker=False):
    with transaction.atomic(using="company"):
        job = Job.objects.select_for_update().get(pk=job_id)
        now = timezone.now()
        if job.status not in ("queued", "running", "retry") or job.available_at > now:
            return False
        if job.lease_until and job.lease_until > now:
            return False
        if (job.kind == "release") != release_worker:
            return False
        ensure_running("release" if release_worker else job.kind)
        if job.attempts >= job.max_attempts:
            job.status, job.failure_code = "failed", "attempt_limit"
            job.save(update_fields=["status", "failure_code"])
            return True
        job.status, job.lease_until = "running", now + timedelta(minutes=15)
        job.save(update_fields=["status", "lease_until"])
    status, failure, complete = "succeeded", "", True
    try:
        if release_worker:
            from .releases import poll_release

            complete = bool(
                poll_release(Release.objects.select_related("work_item").get(pk=job.payload["release_id"]))
            )
        else:
            complete = dispatch(job)
        if not complete:
            if job.created_at < timezone.now() - timedelta(hours=2):
                raise Blocked("runtime_limit", "The workflow exceeded its two-hour runtime limit.")
            status = "queued"
    except Blocked as error:
        status, failure = "blocked", error.code
        if job.payload.get("work_id"):
            WorkItem.objects.filter(pk=job.payload["work_id"]).update(status="blocked", blocker=str(error))
        if job.payload.get("release_id"):
            Release.objects.filter(pk=job.payload["release_id"]).update(status="blocked")
    except Exception as error:
        status, failure = "retry", type(error).__name__
        # Exception text may contain provider URLs/credentials. Preserve only a safe code.
        Incident.objects.get_or_create(
            kind=f"job:{job.pk}",
            defaults={
                "summary": "A company job failed. Inspect its safe failure code and bounded retry state.",
                "evidence": {"job_id": str(job.pk), "code": failure},
            },
        )
    with transaction.atomic(using="company"):
        job = Job.objects.select_for_update().get(pk=job_id)
        job.status, job.failure_code, job.lease_until = status, failure, None
        if status in ("retry", "blocked"):
            job.attempts += 1
        if status == "retry" and job.attempts >= job.max_attempts:
            job.status = "failed"
        job.available_at = timezone.now() + timedelta(
            seconds=30 if status == "queued" else 60 * max(job.attempts, 1)
        )
        if status in ("succeeded", "failed", "blocked"):
            job.finished_at = timezone.now()
        job.save()
    return True


def tick(release_worker=False):
    role = os.environ.get("COMPANY_WORKFLOW_ROLE", "all")
    Heartbeat.objects.update_or_create(
        role="release" if release_worker else f"coordinator:{role}",
        defaults={"last_seen": timezone.now(), "detail": {"mode": "controller", "deployed": False}},
    )
    try:
        ensure_running("release" if release_worker else "company")
    except Blocked:
        return 0
    from .feedback import enqueue

    if not release_worker:
        if role in ("all", "development"):
            enqueue(
                "operations",
                f"operations/{timezone.now():%Y-%m-%d-%H}",
                {},
                os.environ.get(
                    "COMPANY_DATA_MODE",
                    "fixture" if settings.DEBUG else "live",
                ),
            )
        if role in ("all", "marketing") and os.environ.get("MARKETING_AUTORUN") == "1":
            enqueue("marketing", f"marketing/{timezone.now():%Y-%m-%d}", {}, "live")
            from .models import Publication

            for publication in Publication.objects.filter(status="published")[:10]:
                enqueue(
                    "measure",
                    f"measure/{publication.pk}/{timezone.now():%Y-%m-%d}",
                    {"publication_id": str(publication.pk)},
                    "live",
                )
    now = timezone.now()
    jobs = Job.objects.filter(status__in=["queued", "running", "retry"], available_at__lte=now).filter(
        Q(lease_until=None) | Q(lease_until__lte=now)
    )
    jobs = jobs.filter(kind="release") if release_worker else jobs.exclude(kind="release")
    if role == "development":
        jobs = jobs.filter(kind__in=["triage", "build", "operations"])
    elif role == "marketing":
        jobs = jobs.filter(kind__in=["marketing", "publish", "measure"])
    ids = list(jobs.order_by("created_at").values_list("pk", flat=True)[:5])
    count = 0
    for job_id in ids:
        try:
            count += process_job(job_id, release_worker)
        except Blocked:
            break
    return count
