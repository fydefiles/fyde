import hashlib
import re

from django.db import transaction

from .models import Feedback, Incident, Job, WorkItem
from .policy import emit, redact


def enqueue(kind, key, payload, mode="live"):
    return Job.objects.get_or_create(
        dedupe_key=key, defaults={"kind": kind, "payload": payload, "data_mode": mode}
    )[0]


def ingest(feedback_id, title, body, visibility, mode="live", source="in_app", source_id=None):
    with transaction.atomic(using="company"):
        item, created = Feedback.objects.get_or_create(
            pk=feedback_id,
            defaults={
                "title": redact(title)[:140],
                "body": redact(body)
                if visibility == "public"
                else "Private support request; details retained in the customer plane.",
                "visibility": visibility,
                "source": source,
                "source_id": source_id or f"in_app/{feedback_id}",
                "data_mode": mode,
            },
        )
        if created:
            enqueue("triage", f"triage/{item.pk}", {"feedback_id": str(item.pk)}, mode)
            emit(
                "feedback.received",
                f"feedback/{item.pk}",
                mode=mode,
                payload={"feedback_id": str(item.pk), "source": source},
            )
        return item


def triage(item):
    with transaction.atomic(using="company"):
        item = Feedback.objects.select_for_update().get(pk=item.pk)
        if item.status != "received":
            return item.work_item
        text = f"{item.title} {item.body}".lower()
        if any(term in text for term in ("security", "data leak", "unauthorized", "breach", "vulnerability")):
            item.category, item.status = "security", "private_incident"
            item.visibility = "private"
            Incident.objects.create(
                kind="security_report",
                summary="A user submitted a potential security issue. Operator review required.",
                evidence={"feedback_id": str(item.pk), "data_mode": item.data_mode},
            )
            item.save()
            return None
        if item.visibility != "public":
            item.category, item.status = "support", "operator_review"
            item.save()
            return None
        normalized = " ".join(
            sorted(set(re.findall(r"[a-z]{3,}", text)) - {"please", "could", "would", "fyde"})
        )
        item.cluster_key = hashlib.sha256(normalized.encode()).hexdigest()
        duplicate = (
            Feedback.objects.filter(cluster_key=item.cluster_key, work_item__isnull=False)
            .exclude(pk=item.pk)
            .first()
        )
        if duplicate:
            item.work_item, item.status, item.category = duplicate.work_item, "duplicate", duplicate.category
            item.save()
            return duplicate.work_item
        # Eligibility comes from trusted scope, never from a comment claiming operator authority.
        eligible = any(term in text for term in ("help text", "help page", "help section", "explain in help"))
        protected = any(
            term in text
            for term in (
                "disable",
                "bypass",
                "secret",
                "grant access",
                "remove verification",
                "unlimited storage",
                "database",
                "billing change",
                "deploy key",
                "ignore instructions",
                "system prompt",
            )
        )
        eligible = eligible and not protected
        existing = any(
            term in text for term in ("where is pricing", "how to pause sharing", "where is export")
        )
        status = "already_supported" if existing else "prioritized" if eligible else "review_required"
        work = WorkItem.objects.create(
            title=item.title,
            specification={
                "feedback_id": str(item.pk),
                "request": item.body,
                "allowed_path": "content/help.json",
                "scope": "one existing help section; plain text only",
                "rollback": "redeploy previous immutable artifact",
                "max_attempts": 2,
            },
            acceptance=[
                "Only content/help.json changes",
                "Exactly one existing section changes",
                "Plain text and schema validation pass",
                "Trusted application integration suite passes in a network-disabled sandbox",
                "Hosted smoke check passes before requester release notice",
            ],
            priority=60 if eligible else 20,
            rationale="Clarify existing sharing behavior without changing authority."
            if eligible
            else "The request needs operator review because it falls outside the content-only automatic release boundary.",
            risk="low_content" if eligible else "protected",
            status=status,
            data_mode=item.data_mode,
        )
        item.work_item, item.status, item.category = work, "triaged", "usability" if eligible else "feature"
        item.save()
        emit(
            "work.prioritized",
            f"work/{work.pk}",
            mode=item.data_mode,
            payload={"work_item_id": str(work.pk), "risk": work.risk},
        )
        if eligible:
            enqueue("build", f"build/{work.pk}", {"work_id": str(work.pk)}, item.data_mode)
        return work
