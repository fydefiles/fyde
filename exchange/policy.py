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


def current_period(owner, mode=None):
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
    mode = mode or owner.data_mode
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
    if grant.standing_policy_id:
        from .delegation import check_policy

        policy = grant.standing_policy
        check_policy(policy, version=version or grant.version)
        if (
            grant.policy_revision != policy.revision
            or grant.owner_id != policy.owner_id
            or grant.contact_id != policy.contact_id
            or grant.channel != policy.channel
            or grant.identity_kind != policy.identity_kind
        ):
            raise PolicyError("binding_changed", "This case permission changed. Create a new transfer.")
    now = timezone.now()
    owner = owner or grant.owner
    contact = contact or grant.contact
    version = version or grant.version
    document = version.document
    live_external = (grant.channel == "email" and settings.EMAIL_ADAPTER == "resend") or (
        grant.channel == "phone" and settings.SMS_ADAPTER == "twilio"
    )
    if live_external and owner.data_mode != "live":
        raise PolicyError(
            "fixture_identity",
            "Local fixture identities cannot send through a live provider. Create and verify a live account.",
        )
    if not (grant.owner_id == owner.pk == contact.owner_id == document.owner_id):
        raise PolicyError("denied", "This sharing permission is unavailable.")
    if grant.contact_id != contact.pk or grant.version_id != version.pk:
        raise PolicyError("denied", "The permission does not cover this file and contact.")
    if owner.sharing_paused or contact.paused:
        raise PolicyError("paused", "Sharing is paused.")
    if not owner.email_verified:
        raise PolicyError("owner_verification_required", "Verify your email before sharing.")
    verified = (
        (contact.phone and contact.phone_verified_at)
        if grant.identity_kind == "phone"
        else (contact.email and contact.verified_at)
    )
    if not verified or grant.endpoint_revision != contact.endpoint_revision:
        raise PolicyError(
            "verification_required", "The recipient must verify their current contact endpoint."
        )
    if grant.revoked_at or now >= grant.expires_at:
        raise PolicyError("revoked_or_expired", "This sharing permission has expired or been revoked.")
    if document.deleted_at or version.state != "ready":
        raise PolicyError("quarantined", "This file has not passed the configured safety checks.")
    if document.sensitive and not grant.sensitive_authorized:
        raise PolicyError("owner_authorization_required", "Sensitive files need an explicit permission.")
    if grant.channel not in ("in_app", "email", "phone") or grant.identity_kind not in ("email", "phone"):
        raise PolicyError("unsupported_channel", "This permission uses an unsupported delivery channel.")
    if grant.channel in ("email", "phone") and grant.channel != grant.identity_kind:
        raise PolicyError(
            "binding_changed", "This permission does not match the selected recipient endpoint."
        )


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
    if transfer.binding_version >= 2:
        values.extend(
            [transfer.channel, transfer.recipient_phone, transfer.grant.identity_kind, transfer.contact.phone]
        )
    if transfer.binding_version >= 3:
        values.extend([str(transfer.grant.standing_policy_id or ""), str(transfer.grant.policy_revision)])
    return hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()


def check_transfer(transfer):
    if transfer.binding_version not in (1, 2, 3) or (
        transfer.grant.standing_policy_id and transfer.binding_version < 3
    ):
        raise PolicyError("binding_changed", "This transfer uses an unsupported binding version.")
    if transfer.data_mode != transfer.owner.data_mode:
        raise PolicyError("mode_changed", "This transfer belongs to a different identity mode.")
    check_grant(transfer.grant, owner=transfer.owner, contact=transfer.contact, version=transfer.version)
    if transfer.channel != transfer.grant.channel or (
        transfer.binding_version == 1
        and (
            transfer.channel != "email" or transfer.recipient_phone or transfer.grant.identity_kind != "email"
        )
    ):
        raise PolicyError("binding_changed", "The delivery channel changed. Create a new transfer.")
    if transfer.revoked_at or timezone.now() >= transfer.expires_at:
        raise PolicyError("revoked_or_expired", "This transfer has expired or been revoked.")
    if not hmac.compare_digest(transfer.binding, execution_binding(transfer)):
        raise PolicyError(
            "binding_changed", "The file, recipient, or permission changed. Create a new transfer."
        )


def reserve_quota(owner, mode=None):
    period = current_period(owner, mode)
    _, plan, _ = entitlement(owner)
    condition = UsagePeriod.objects.filter(pk=period.pk)
    if plan["sends"] is not None:
        condition = condition.filter(consumed__lt=plan["sends"] - F("reserved"))
    if not condition.update(reserved=F("reserved") + 1):
        raise PolicyError(
            "quota_exceeded",
            "Your monthly allowance is used or reserved by queued sends. Cancel an unsent transfer to release its reservation.",
        )
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
    from .models import InboxItem, Transfer

    transfer = Transfer.objects.select_for_update().get(pk=transfer.pk)
    if transfer.accessed_at or InboxItem.objects.filter(transfer=transfer).exists():
        return
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
