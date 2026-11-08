"""Owner-defined case permissions. The customer responder has no company-agent authority."""

import hashlib
import json
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import (
    DOCUMENT_TYPES,
    CaseRequest,
    Contact,
    Document,
    FileVersion,
    Grant,
    Matter,
    StandingPolicy,
    User,
)
from .policy import PolicyError, audit
from .recipients import account_for, refresh_contact_identity, resolve_app_recipient
from .transfers import create_transfer, revoke_transfer


def document_types(values):
    if not isinstance(values, list) or not values or len(values) > 12:
        raise PolicyError("invalid_types", "Choose at least one document type, or all types.")
    values = sorted(set(values)) if all(isinstance(v, str) for v in values) else []
    if not values or any(v not in {"*", *dict(DOCUMENT_TYPES)} for v in values):
        raise PolicyError("invalid_types", "Choose supported document types.")
    return ["*"] if "*" in values else values


def check_policy(policy, *, requester=None, version=None):
    now = timezone.now()
    if (
        policy.revoked_at
        or now >= policy.expires_at
        or policy.owner.sharing_paused
        or policy.contact.paused
        or not policy.owner.is_active
        or not policy.owner.email_verified
        or policy.contact.owner_id != policy.owner_id
        or policy.matter.owner_id != policy.owner_id
        or policy.endpoint_revision != policy.contact.endpoint_revision
        or policy.data_mode != policy.owner.data_mode
        or policy.data_mode != policy.recipient.data_mode
    ):
        raise PolicyError(
            "permission_unavailable", "This case permission is paused, expired, changed or unavailable."
        )
    verified = account_for(policy.contact, policy.data_mode, policy.identity_kind)
    if not verified or verified.pk != policy.recipient_id or (requester and requester.pk != verified.pk):
        raise PolicyError(
            "permission_unavailable", "This case permission is unavailable for this verified account."
        )
    if policy.channel not in ("in_app", "email", "phone") or policy.identity_kind not in ("email", "phone"):
        raise PolicyError("permission_unavailable", "This case permission is unavailable.")
    if policy.channel != "in_app" and policy.channel != policy.identity_kind:
        raise PolicyError("permission_unavailable", "The case permission does not cover this channel.")
    if version:
        doc = version.document
        initial = policy.initial_versions.get(str(doc.pk))
        allowed = (
            doc.owner_id == policy.owner_id
            and doc.matter_id == policy.matter_id
            and not doc.deleted_at
            and ("*" in policy.document_types or doc.document_type in policy.document_types)
            and (not doc.sensitive or policy.include_sensitive)
            and (bool(initial) or policy.include_future_files)
            and (
                policy.include_future_versions
                or str(version.pk) == initial
                or (not initial and version.number == 1)
            )
        )
        if not allowed:
            raise PolicyError("outside_case_scope", "This version is outside the owner’s case permission.")


@transaction.atomic
def create_policy(
    owner,
    *,
    contact_id,
    matter_id,
    operation_id,
    types,
    days=90,
    max_requests=100,
    channel="in_app",
    include_future_files=False,
    include_future_versions=False,
    include_sensitive=False,
):
    owner = User.objects.select_for_update().get(pk=owner.pk)
    types = document_types(types)
    if (
        not isinstance(days, int)
        or not 1 <= days <= 365
        or not isinstance(max_requests, int)
        or not 1 <= max_requests <= 1000
    ):
        raise PolicyError("invalid_limits", "Use 1–365 days and 1–1,000 automatic requests.")
    if not owner.email_verified or owner.sharing_paused:
        raise PolicyError(
            "owner_verification_required",
            "Verify your email and resume sharing before enabling automatic requests.",
        )
    try:
        contact = Contact.objects.get(pk=contact_id, owner=owner)
        matter = Matter.objects.get(pk=matter_id, owner=owner)
    except (Contact.DoesNotExist, Matter.DoesNotExist, ValueError):
        raise PolicyError("not_found", "Choose your own contact and case.") from None
    refresh_contact_identity(contact, owner.data_mode)
    recipient, kind = resolve_app_recipient(contact, owner.data_mode)
    if channel in ("email", "phone"):
        selected = account_for(contact, owner.data_mode, channel)
        if not selected or selected.pk != recipient.pk:
            raise PolicyError(
                "verification_required",
                "The selected channel must identify the same verified recipient account.",
            )
        kind = channel
    elif channel != "in_app":
        raise PolicyError("unsupported_channel", "Choose Fyde, email, or phone.")
    existing = StandingPolicy.objects.filter(owner=owner, operation_id=operation_id).first()
    if existing:
        expected = (
            str(contact.pk),
            str(matter.pk),
            types,
            channel,
            include_future_files,
            include_future_versions,
            include_sensitive,
            max_requests,
            days,
        )
        actual = (
            str(existing.contact_id),
            str(existing.matter_id),
            existing.document_types,
            existing.channel,
            existing.include_future_files,
            existing.include_future_versions,
            existing.include_sensitive,
            existing.max_requests,
            round((existing.expires_at - existing.created_at).total_seconds() / 86400),
        )
        if expected != actual:
            raise PolicyError(
                "idempotency_conflict", "This operation already created a different permission."
            )
        return existing
    initial = {
        str(d.pk): str(d.current_version_id)
        for d in Document.objects.filter(
            owner=owner, matter=matter, deleted_at=None, current_version__isnull=False
        )
    }
    policy = StandingPolicy.objects.create(
        owner=owner,
        contact=contact,
        recipient=recipient,
        matter=matter,
        operation_id=operation_id,
        endpoint_revision=contact.endpoint_revision,
        identity_kind=kind,
        channel=channel,
        data_mode=owner.data_mode,
        document_types=types,
        initial_versions=initial,
        include_future_files=include_future_files,
        include_future_versions=include_future_versions,
        include_sensitive=include_sensitive,
        expires_at=timezone.now() + timedelta(days=days),
        max_requests=max_requests,
    )
    check_policy(policy)
    audit(owner, "case_permission.enabled", policy.pk, "owner_authorized", recipient_id=recipient.pk)
    return policy


def candidates(policy):
    docs = Document.objects.filter(owner=policy.owner, matter=policy.matter, deleted_at=None).select_related(
        "current_version"
    )
    versions = {}
    for doc in docs:
        original = policy.initial_versions.get(str(doc.pk))
        if policy.include_future_versions:
            version = doc.current_version
        elif original:
            version = FileVersion.objects.filter(pk=original, document=doc).first()
        else:
            version = doc.versions.filter(number=1).first() if policy.include_future_files else None
        if not version or version.state != "ready":
            continue
        version.document = doc
        try:
            check_policy(policy, version=version)
            versions[str(doc.pk)] = version
        except PolicyError:
            continue
    return versions


@transaction.atomic
def fulfill_case(requester, policy_id, operation_id, *, types=None, query="", after=""):
    try:
        policy = (
            StandingPolicy.objects.select_for_update(of=("self",))
            .select_related("owner", "contact", "recipient", "matter")
            .get(pk=policy_id, recipient=requester)
        )
    except (StandingPolicy.DoesNotExist, ValueError):
        raise PolicyError("permission_unavailable", "This case permission is unavailable.") from None
    check_policy(policy, requester=requester)
    types = document_types(["*"] if types is None else types)
    if not isinstance(query, str) or len(query) > 180 or not isinstance(after, str) or len(after) > 36:
        raise PolicyError("invalid_request", "Use a short filename or document type.")
    payload = [str(policy.pk), types, query.strip().lower(), after]
    fingerprint = hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()
    record, created = CaseRequest.objects.get_or_create(
        requester=requester, operation_id=operation_id, defaults={"policy": policy, "input_hash": fingerprint}
    )
    if record.input_hash != fingerprint:
        raise PolicyError("idempotency_conflict", "This operation was used for a different document request.")
    if not created:
        return record
    if policy.requests_used >= policy.max_requests:
        raise PolicyError("request_limit", "This permission has reached its automatic request limit.")
    selected = [
        (key, v)
        for key, v in sorted(candidates(policy).items())
        if key > after
        and ("*" in types or v.document.document_type in types)
        and (not query or query.lower() in f"{v.document.title} {v.original_name}".lower())
    ]
    page, remaining = selected[:10], len(selected) > 10
    outcomes = []
    for index, (_, version) in enumerate(page):
        try:
            with transaction.atomic():
                grant = Grant.objects.create(
                    owner=policy.owner,
                    contact=policy.contact,
                    version=version,
                    standing_policy=policy,
                    policy_revision=policy.revision,
                    endpoint_revision=policy.endpoint_revision,
                    kind="case",
                    purpose=policy.matter.name[:150],
                    sensitive_authorized=policy.include_sensitive,
                    expires_at=policy.expires_at,
                    channel=policy.channel,
                    identity_kind=policy.identity_kind,
                )
                transfer = create_transfer(
                    policy.owner,
                    version,
                    policy.contact,
                    f"case/{record.pk}/{index}",
                    grant=grant,
                    channel=policy.channel,
                )
                outcomes.append({"transfer_id": str(transfer.pk), "state": transfer.status})
        except PolicyError as error:
            outcomes.append(
                {
                    "state": error.code
                    if error.code
                    in ("quota_exceeded", "paused", "mode_changed", "sms_disabled", "email_disabled")
                    else "unavailable"
                }
            )
    if page:
        policy.requests_used = F("requests_used") + 1
        policy.save(update_fields=["requests_used"])
    record.result = {
        "request_id": str(record.pk),
        "outcomes": outcomes,
        "next_cursor": page[-1][0] if remaining else None,
        "message": "The owner’s case permission was applied automatically."
        if outcomes
        else "No available documents match this permission and request.",
    }
    record.save(update_fields=["result"])
    audit(
        policy.owner,
        "case_request.fulfilled",
        record.pk,
        "automatic",
        policy_id=str(policy.pk),
        item_count=len(outcomes),
    )
    return record


@transaction.atomic
def revoke_policy(owner, policy_id):
    policy = StandingPolicy.objects.select_for_update().get(pk=policy_id, owner=owner)
    policy.revoked_at = timezone.now()
    policy.revision += 1
    policy.save(update_fields=["revoked_at", "revision"])
    for transfer in policy.grants.values_list("transfer__pk", flat=True).exclude(transfer__pk=None):
        revoke_transfer(owner, transfer)
    audit(owner, "case_permission.revoked", policy.pk, "deny")
