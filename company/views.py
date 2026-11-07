import json
import re
from pathlib import Path

from django.conf import settings
from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth.decorators import login_required
from django.db.models import Count
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from exchange.forms import FeedbackForm
from exchange.identity import rate_limit
from exchange.models import FeedbackBridge, ProductMetric
from exchange.policy import PolicyError

from .feedback import enqueue
from .models import (
    Carousel,
    Control,
    CostEntry,
    Event,
    Feedback,
    FounderAction,
    Heartbeat,
    Incident,
    Job,
    Publication,
    Release,
    SourceClaim,
    WorkItem,
)
from .policy import emit, paused


def help_page(request):
    content = json.loads((settings.BASE_DIR / "content/help.json").read_text())
    if request.user.is_authenticated:
        ProductMetric.objects.create(
            owner=request.user, kind="help_view", feature="help_content", data_mode=request.user.data_mode
        )
    return render(request, "exchange/help.html", {"help_content": content})


@login_required
def feedback(request):
    form = FeedbackForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            rate_limit(f"feedback:{request.user.pk}", 10, 3600)
            FeedbackBridge.objects.create(
                owner=request.user,
                title=form.cleaned_data["title"],
                body=form.cleaned_data["body"],
                visibility=form.cleaned_data["visibility"],
            )
            messages.success(
                request,
                "Thank you. Your feedback is recorded. The company queue will show its actual progress.",
            )
            return redirect("feedback")
        except PolicyError as error:
            form.add_error(None, str(error))
    public = (
        Feedback.objects.filter(visibility="public").exclude(category="security").order_by("-created_at")[:30]
    )
    return render(
        request,
        "exchange/feedback.html",
        {
            "form": form,
            "public_feedback": public,
            "own_feedback": FeedbackBridge.objects.filter(owner=request.user).order_by("-created_at")[:20],
        },
    )


@login_required
@require_POST
def withdraw_feedback(request, feedback_id):
    bridge = get_object_or_404(FeedbackBridge, pk=feedback_id, owner=request.user)
    item = Feedback.objects.filter(pk=bridge.pk).first()
    if item:
        if item.work_item_id:
            work = item.work_item
            if work.specification.get("feedback_id") == str(item.pk):
                work.specification = {**work.specification, "request": "Feedback withdrawn by its author."}
                work.title = "Withdrawn feedback"
                work.save(update_fields=["specification", "title"])
        item.title, item.body, item.visibility, item.status = "Withdrawn feedback", "", "private", "withdrawn"
        item.save()
    bridge.delete()
    messages.success(request, "Your feedback text was withdrawn. Minimal workflow evidence remains.")
    return redirect("feedback")


@staff_member_required(login_url="/login/")
def dashboard(request):
    counts = {r["status"]: r["n"] for r in Job.objects.values("status").annotate(n=Count("pk"))}
    all_jobs = Job.objects.filter(data_mode="live").count()
    # Every observed job remains in the eligibility denominator, including blocks and failures.
    eligible_jobs = Job.objects.filter(data_mode="live")
    eligible = eligible_jobs.count()
    attempted = eligible_jobs.exclude(status="queued").count()
    completed = eligible_jobs.filter(status="succeeded", human_interventions=0).count()
    aggregates = {}
    for mode in ("live", "fixture", "manual", "sandbox"):
        row = (
            Event.objects.filter(event_type="product.aggregate", data_mode=mode)
            .order_by("-created_at")
            .first()
        )
        aggregates[mode] = (
            row.payload
            if row
            else {
                key: None
                for key in (
                    "activated",
                    "accepted_sends",
                    "recipient_downloads_started",
                    "repeat_senders",
                    "observed_at",
                )
            }
        )
    readiness = [
        (
            "Email",
            settings.EMAIL_ADAPTER,
            "local test outbox"
            if settings.EMAIL_ADAPTER == "local"
            else "Configured; live evidence appears on transfer receipts",
        ),
        (
            "Naïve",
            "configured_unverified"
            if settings.NAIVE_API_KEY and settings.NAIVE_AGENT_ID
            else "not_configured",
            "Needs denied-tool agent, version pin, scoped credentials, and budgets",
        ),
        (
            "Reddit",
            "awaiting_approval",
            "Automated Reddit access stays disabled until commercial API approval and a subreddit are configured",
        ),
        (
            "Instagram",
            "configured_unverified" if settings.INSTAGRAM_ACCESS_TOKEN else "not_configured",
            "Approved professional account and supported Facebook Login path required",
        ),
        (
            "Stripe",
            "sandbox_configured"
            if settings.STRIPE_API_KEY and not settings.STRIPE_LIVE_ENABLED
            else "live_activation_enabled"
            if settings.STRIPE_API_KEY
            else "not_configured",
            "Webhook evidence determines entitlement; redirects do not",
        ),
        (
            "Deployment",
            "activation_enabled" if settings.COMPANY_RELEASE_ENABLED else "awaiting_approval",
            "Protected dev, immutable verifier, separate GitHub App token and hosted smoke checks required",
        ),
    ]
    return render(
        request,
        "company/dashboard.html",
        {
            "paused": paused(),
            "jobs": Job.objects.order_by("-created_at")[:30],
            "job_counts": counts,
            "work": WorkItem.objects.order_by("-priority", "created_at")[:30],
            "feedback_count": Feedback.objects.count(),
            "carousels": Carousel.objects.order_by("-created_at")[:10],
            "publications": Publication.objects.order_by("-created_at")[:10],
            "claims": SourceClaim.objects.order_by("key"),
            "founder_actions": FounderAction.objects.exclude(status="verified"),
            "incidents": Incident.objects.filter(status="open"),
            "costs": CostEntry.objects.order_by("-created_at")[:30],
            "heartbeats": Heartbeat.objects.all(),
            "aggregates": aggregates,
            "connectors": readiness,
            "all_jobs": all_jobs,
            "eligible_jobs": eligible,
            "attempted": attempted,
            "completed": completed,
            "events": Event.objects.order_by("-created_at")[:30],
        },
    )


@staff_member_required(login_url="/login/")
@require_POST
def control(request):
    action = request.POST.get("action")
    if action == "pause":
        new_state = not paused()
        Control.objects.update_or_create(key="global_pause", defaults={"value": {"paused": new_state}})
        emit(
            "operator.pause_changed",
            f"pause/{timezone.now().isoformat()}",
            mode="manual",
            actor="operator",
            payload={"paused": new_state},
        )
    elif action == "marketing":
        enqueue("marketing", f"marketing/{timezone.now():%Y-%m-%d}", {}, "manual")
        messages.success(
            request, "Research and rendering queued. Publishing remains a separate authorized workflow."
        )
    elif action == "publish":
        carousel = get_object_or_404(Carousel, pk=request.POST.get("carousel_id"))
        enqueue("publish", f"publish/{carousel.pk}", {"carousel_id": str(carousel.pk)}, "live")
    elif action == "retry":
        job = get_object_or_404(Job, pk=request.POST.get("job_id"), status__in=["blocked", "failed"])
        if job.attempts >= job.max_attempts:
            messages.error(
                request,
                "Attempt limit reached. Inspect and resolve the incident before creating another work item.",
            )
        else:
            job.status, job.available_at, job.finished_at = "queued", timezone.now(), None
            job.human_interventions += 1
            job.save()
            emit(
                "operator.job_retried",
                f"retry/{job.pk}/{job.human_interventions}",
                mode="manual",
                actor="operator",
                payload={"job_id": str(job.pk)},
            )
    return redirect("company_dashboard")


@staff_member_required(login_url="/login/")
def work_detail(request, work_id):
    work = get_object_or_404(WorkItem, pk=work_id)
    return render(
        request,
        "company/work.html",
        {
            "work": work,
            "feedback": work.feedback_set.all(),
            "releases": Release.objects.filter(work_item=work),
            "evidence": json.dumps(work.evidence, indent=2),
        },
    )


@staff_member_required(login_url="/login/")
def carousel_detail(request, carousel_id):
    carousel = get_object_or_404(Carousel, pk=carousel_id)
    return render(
        request,
        "company/carousel.html",
        {
            "carousel": carousel,
            "publication": Publication.objects.filter(carousel=carousel).first(),
            "claims": SourceClaim.objects.filter(pk__in=carousel.claim_ids),
        },
    )


def asset(request, carousel_id, filename):
    if not re.fullmatch(r"slide-\d{2}\.jpg|ready-to-publish\.zip", filename):
        raise Http404
    if not (request.user.is_authenticated and request.user.is_staff):
        if not settings.CONTENT_PUBLIC_ORIGIN or filename.endswith(".zip"):
            raise Http404
    carousel = get_object_or_404(
        Carousel, pk=carousel_id, status__in=["quality_passed", "scheduled", "publishing", "published"]
    )
    expected = settings.VAR_DIR / "marketing" / str(carousel.pk)
    if Path(carousel.asset_dir).resolve() != expected.resolve():
        raise Http404
    path = expected / filename
    if not path.is_file():
        raise Http404
    return FileResponse(
        path.open("rb"),
        content_type="application/zip" if filename.endswith("zip") else "image/jpeg",
        as_attachment=filename.endswith("zip"),
        filename=filename,
    )
