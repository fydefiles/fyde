import hashlib
import json
import re
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import BudgetDay, Control, CostEntry, Event


class Blocked(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def paused(workflow=""):
    global_state = Control.objects.filter(key="global_pause").first()
    local_state = Control.objects.filter(key=f"pause:{workflow}").first()
    return (
        settings.COMPANY_PAUSED
        or bool(global_state and global_state.value.get("paused"))
        or bool(local_state and local_state.value.get("paused"))
    )


def ensure_running(workflow):
    if paused(workflow):
        raise Blocked("paused", "Company operations are paused by the operator.")


def redact(text):
    text = text[:4000]
    text = re.sub(r"(?i)(?:sk|rk|re|whsec|ghp|github_pat)[_-][A-Za-z0-9_-]{8,}", "[credential removed]", text)
    text = re.sub(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[email removed]", text, flags=re.I)
    text = re.sub(r"https?://\S+", "[link removed]", text)
    text = re.sub(r"\b(?:\+?\d[\d ()-]{8,}\d)\b", "[number removed]", text)
    return text.strip()


def emit(event, key, *, mode="live", actor="controller", payload=None):
    return Event.objects.get_or_create(
        idempotency_key=key,
        defaults={"event_type": event, "data_mode": mode, "actor": actor, "payload": payload or {}},
    )[0]


@transaction.atomic(using="company")
def reserve_spend(external_id, category, provider, amount, work_item_id=None):
    previous = CostEntry.objects.filter(external_id=external_id).first()
    if previous:
        return previous
    try:
        value = Decimal(str(amount))
        cap = Decimal(settings.COMPANY_DAILY_BUDGET_USD)
    except (ValueError, InvalidOperation):
        raise Blocked(
            "budget_missing", "Configure positive task and daily budgets before external company work."
        ) from None
    if not value.is_finite() or not cap.is_finite() or value <= 0 or cap <= 0:
        raise Blocked("budget_missing", "Company paid actions default to zero until budgets are configured.")
    day, _ = BudgetDay.objects.select_for_update().get_or_create(date=timezone.now().date())
    if day.reserved_usd + value > cap:
        raise Blocked("budget_exceeded", "Company daily budget is exhausted.")
    day.reserved_usd += value
    day.save(update_fields=["reserved_usd"])
    return CostEntry.objects.create(
        external_id=external_id,
        category=category,
        provider=provider,
        estimated_usd=value,
        data_mode="live",
        work_item_id=work_item_id,
    )


def validate_help_patch(baseline, candidate):
    """Trusted code accepts plain text in exactly one existing section. It accepts no executable patch."""
    if not isinstance(candidate, dict) or set(candidate) != {"version", "sections"}:
        raise Blocked("protected_change", "Help content has an invalid schema.")
    if candidate["version"] != baseline["version"] or len(candidate["sections"]) != len(baseline["sections"]):
        raise Blocked("protected_change", "The builder cannot change content structure or version policy.")
    changed = []
    for old, new in zip(baseline["sections"], candidate["sections"], strict=True):
        if not isinstance(new, dict) or set(new) != {"id", "title", "body"} or old["id"] != new["id"]:
            raise Blocked("protected_change", "Only an existing help section's plain text can change.")
        for key, maximum in [("title", 100), ("body", 1000)]:
            value = new[key]
            if (
                not isinstance(value, str)
                or not 5 <= len(value) <= maximum
                or re.search(r"[<>\x00-\x08]|https?://|@|\$\(|```", value)
            ):
                raise Blocked(
                    "unsafe_content", "The patch contains unsupported markup, links, or unbounded text."
                )
        if old != new:
            changed.append(new["id"])
    if len(changed) != 1:
        raise Blocked("unbounded_patch", "One autonomous change may update exactly one help section.")
    return {
        "changed_sections": changed,
        "sha256": hashlib.sha256(json.dumps(candidate, sort_keys=True).encode()).hexdigest(),
        "allowed_paths": ["content/help.json"],
    }
