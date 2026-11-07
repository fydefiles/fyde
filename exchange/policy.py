import hashlib
import hmac
import json
from datetime import datetime, timezone as dt_timezone

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import AuditEvent, Subscription, UsageEntry, UsagePeriod


class PolicyError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def plans():
    return json.loads((settings.BASE_DIR / "content/plans.json").read_text())


def entitlement(owner):
    sub, _ = Subscription.objects.get_or_create(owner=owner)
    # Sandbox entitlements never become live paid entitlements.
    eligible = sub.status in ("active", "trialing") and sub.period_end and sub.period_end > timezone.now()
    eligible = eligible and (sub.data_mode == "live" or (settings.DEBUG and owner.data_mode == "fixture"))
    key = sub.plan if eligible else "free"
    return key, plans()["plans"].get(key, plans()["plans"]["free"]), sub


def current_period(owner):
    _, _, sub = entitlement(owner)
    now = timezone.now()
    if (
        sub.status in ("active", "trialing")
        and sub.period_start
        and sub.period_end
        and sub.period_start <= now < sub.period_end
    ):
        start, end = sub.period_start, sub.period_end
    else:
        start = datetime(now.year, now.month, 1, tzinfo=dt_timezone.utc)
        end = datetime(now.year + (now.month == 12), now.month % 12 + 1, 1, tzinfo=dt_timezone.utc)
    mode = "fixture" if settings.EMAIL_ADAPTER == "local" else "live"
    period, _ = UsagePeriod.objects.get_or_create(
        owner=owner, starts_at=start, data_mode=mode, defaults={"ends_at": end}
    )
    return period


def audit(owner, event, object_id="", decision="", **detail):
    return AuditEvent.objects.create(
        owner=owner,
        event_type=event,
        object_id=str(object_id),
        decision=decision,
        data_mode=owner.data_mode,
        detail=detail,
    )


def check_grant(grant, *, owner=None, contact=None, version=None):
    now = timezone.now()
    owner = owner or grant.owner
    contact = contact or grant.contact
    version = version or grant.version
    document = version.document
    if not (grant.owner_id == owner.pk == contact.owner_id == document.owner_id):
        raise PolicyError("denied", "This sharing permission is unavailable.")
    if grant.contact_id != contact.pk or grant.version_id != version.pk:
        raise PolicyError("denied", "The permission does not cover this file and contact.")
    if owner.sharing_paused or contact.paused:
        raise PolicyError("paused", "Sharing is paused.")
    if not owner.email_verified:
        raise PolicyError("owner_verification_required", "Verify your email before sharing.")
    if not contact.verified_at or grant.endpoint_revision != contact.endpoint_revision:
        raise PolicyError("verification_required", "The recipient must verify their current email address.")
    if grant.revoked_at or now >= grant.expires_at:
        raise PolicyError("revoked_or_expired", "This sharing permission has expired or been revoked.")
    if document.deleted_at or version.state != "ready":
        raise PolicyError("quarantined", "This file has not passed the configured safety checks.")
    if document.sensitive and not grant.sensitive_authorized:
        raise PolicyError("owner_authorization_required", "Sensitive files need an explicit permission.")
    if grant.channel != "email":
        raise PolicyError("unsupported_channel", "This permission does not allow email delivery.")


def execution_binding(transfer):
    values = [
        str(transfer.owner_id),
        str(transfer.version_id),
        transfer.version.sha256,
        str(transfer.contact_id),
        transfer.contact.email.lower(),
        str(transfer.contact.endpoint_revision),
        transfer.recipient_email.lower(),
        str(transfer.endpoint_revision_snapshot),
        str(transfer.grant_id),
        str(transfer.grant.revision),
        transfer.operation_id,
        transfer.expires_at.isoformat(),
        "email",
    ]
    return hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()


def check_transfer(transfer):
    check_grant(transfer.grant, owner=transfer.owner, contact=transfer.contact, version=transfer.version)
    if transfer.revoked_at or timezone.now() >= transfer.expires_at:
        raise PolicyError("revoked_or_expired", "This transfer has expired or been revoked.")
    if not hmac.compare_digest(transfer.binding, execution_binding(transfer)):
        raise PolicyError(
            "binding_changed", "The file, recipient, or permission changed. Create a new transfer."
        )


def reserve_quota(owner):
    period = current_period(owner)
    _, plan, _ = entitlement(owner)
    condition = UsagePeriod.objects.filter(pk=period.pk)
    if plan["sends"] is not None:
        condition = condition.filter(consumed__lt=plan["sends"] - F("reserved"))
    if not condition.update(reserved=F("reserved") + 1):
        raise PolicyError("quota_exceeded", "Your monthly send allowance is used. No send was charged.")
    return period


def settle_quota(transfer, accepted):
    # Call with a locked transfer inside a transaction. Every transition is append-only in the ledger.
    if transfer.quota_state != "reserved":
        return
    kind = "accepted" if accepted else "released"
    UsageEntry.objects.get_or_create(
        transfer=transfer,
        kind=kind,
        defaults={
            "owner": transfer.owner,
            "units": 1 if accepted else 0,
            "data_mode": transfer.data_mode,
        },
    )
    updates = {"reserved": F("reserved") - 1}
    if accepted:
        updates["consumed"] = F("consumed") + 1
    UsagePeriod.objects.filter(pk=transfer.usage_period_id, reserved__gt=0).update(**updates)
    transfer.quota_state = "consumed" if accepted else "released"
    transfer.save(update_fields=["quota_state"])


@transaction.atomic
def reverse_quota(transfer):
    from .models import Transfer

    transfer = Transfer.objects.select_for_update().get(pk=transfer.pk)
    if transfer.quota_state != "consumed":
        return
    UsageEntry.objects.get_or_create(
        transfer=transfer,
        kind="reversed",
        defaults={
            "owner": transfer.owner,
            "units": -1,
            "data_mode": transfer.data_mode,
        },
    )
    UsagePeriod.objects.filter(pk=transfer.usage_period_id, consumed__gt=0).update(consumed=F("consumed") - 1)
    transfer.quota_state = "reversed"
    transfer.save(update_fields=["quota_state"])
