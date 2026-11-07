import hashlib
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .identity import data_mode, queue_mail
from .models import Contact, FileVersion, Grant, IncomingRequest, Mail, Transfer, User
from .policy import PolicyError, audit, check_grant, execution_binding, reserve_quota, settle_quota


@transaction.atomic
def create_transfer(owner, version, contact, operation_id, grant=None):
    User.objects.select_for_update().get(pk=owner.pk)
    existing = Transfer.objects.filter(owner=owner, operation_id=operation_id).first()
    if existing:
        if existing.version_id != version.pk or existing.contact_id != contact.pk:
            raise PolicyError(
                "idempotency_conflict", "This operation ID was already used for a different transfer."
            )
        return existing
    # Reload every authority-bearing object. Client/session/model objects are only candidates.
    owner = User.objects.get(pk=owner.pk)
    try:
        version = FileVersion.objects.select_related("document").get(pk=version.pk, document__owner=owner)
        contact = Contact.objects.select_for_update().get(pk=contact.pk, owner=owner)
    except (FileVersion.DoesNotExist, Contact.DoesNotExist):
        raise PolicyError("not_found", "The file or contact is unavailable.") from None
    now = timezone.now()
    if grant:
        grant = Grant.objects.select_for_update().get(pk=grant.pk, owner=owner)
    elif version.document.sensitive:
        grant = (
            Grant.objects.select_for_update()
            .filter(
                owner=owner,
                contact=contact,
                version=version,
                sensitive_authorized=True,
                revoked_at=None,
                expires_at__gt=now,
            )
            .first()
        )
        if not grant:
            raise PolicyError(
                "owner_authorization_required", "Create an explicit permission for this sensitive file first."
            )
    else:
        grant = Grant.objects.create(
            owner=owner,
            contact=contact,
            version=version,
            endpoint_revision=contact.endpoint_revision,
            expires_at=now + timedelta(hours=24),
        )
    check_grant(grant, owner=owner, contact=contact, version=version)
    if grant.requests_used >= grant.max_requests:
        raise PolicyError("grant_limit", "This permission has reached its request limit.")
    period = reserve_quota(owner)
    grant.requests_used = F("requests_used") + 1
    grant.save(update_fields=["requests_used"])
    grant.refresh_from_db()
    transfer = Transfer(
        owner=owner,
        contact=contact,
        version=version,
        grant=grant,
        operation_id=operation_id,
        data_mode=data_mode(),
        usage_period=period,
        recipient_email=contact.email,
        endpoint_revision_snapshot=contact.endpoint_revision,
        expires_at=min(now + timedelta(hours=24), grant.expires_at),
    )
    transfer.binding = execution_binding(transfer)
    transfer.save()
    # A UUID in the route contains neither filenames nor recipients. A separate email code gates access.
    link = f"{settings.SITE_URL}/access/{transfer.pk}/"
    queue_mail(
        owner,
        contact.email,
        f"{owner.first_name or 'A Fyde user'} shared a file with you",
        f"A file is available for your verified email address.\n\nOpen {link}\n\n"
        "You will receive a separate verification code before downloading. This link expires within 24 hours. "
        "The owner can revoke access. Already downloaded copies cannot be recalled.",
        f"transfer/{transfer.pk}",
        transfer=transfer,
    )
    audit(
        owner, "transfer.authorized", transfer.pk, "allow", grant_id=str(grant.pk), version_id=str(version.pk)
    )
    return transfer


@transaction.atomic
def revoke_transfer(owner, transfer_id):
    transfer = Transfer.objects.select_for_update().get(pk=transfer_id, owner=owner)
    transfer.revoked_at = timezone.now()
    transfer.status = "revoked"
    uncertain = Mail.objects.filter(
        transfer=transfer, status__in=["sending", "uncertain", "reconciliation_required"]
    ).exists()
    if not uncertain:
        settle_quota(transfer, False)
    else:
        Mail.objects.filter(transfer=transfer, status__in=["sending", "uncertain"]).update(
            status="reconciliation_required"
        )
        transfer.failure_code = "revoked_with_uncertain_provider_outcome"
    transfer.save(update_fields=["revoked_at", "status", "failure_code"])
    Mail.objects.filter(transfer=transfer, status__in=["queued", "retry", "blocked"]).update(
        status="canceled"
    )
    audit(owner, "transfer.revoked", transfer.pk, "deny")


@transaction.atomic
def change_endpoint(owner, contact_id, email):
    contact = Contact.objects.select_for_update().get(pk=contact_id, owner=owner)
    if email.lower() != contact.email.lower():
        contact.email = email.lower()
        contact.endpoint_revision += 1
        contact.verified_at = None
        contact.save(update_fields=["email", "endpoint_revision", "verified_at"])
        Grant.objects.filter(contact=contact, revoked_at=None).update(
            revoked_at=timezone.now(), revision=F("revision") + 1
        )
        audit(owner, "contact.endpoint_changed", contact.pk, "verification_required")
    return contact


@transaction.atomic
def fulfill_request(contact, version_ids, purpose, operation_id):
    # The caller must establish recipient identity before entering this service.
    contact = Contact.objects.select_for_update().select_related("owner").get(pk=contact.pk)
    request, created = IncomingRequest.objects.get_or_create(
        contact=contact,
        operation_id=operation_id,
        defaults={"owner": contact.owner, "purpose": purpose[:150]},
    )
    if not created:
        return request
    outcomes = []
    for index, version_id in enumerate(version_ids[:10]):
        try:
            with transaction.atomic():
                parsed_id = uuid.UUID(str(version_id))
                grant = (
                    Grant.objects.select_for_update()
                    .select_related("version", "version__document")
                    .filter(
                        contact=contact,
                        owner=contact.owner,
                        version_id=parsed_id,
                        kind="standing",
                        purpose=purpose,
                        revoked_at=None,
                        expires_at__gt=timezone.now(),
                    )
                    .first()
                )
                if not grant:
                    # Same public answer for missing, foreign, unauthorized, expired and mismatched-purpose files.
                    raise PolicyError("unavailable", "This item is unavailable under your permission.")
                transfer = create_transfer(
                    contact.owner, grant.version, contact, f"request/{request.pk}/{index}", grant=grant
                )
                outcomes.append(
                    {"item": index + 1, "state": transfer.status, "transfer_id": str(transfer.pk)}
                )
        except (PolicyError, ValueError) as error:
            outcomes.append(
                {
                    "item": index + 1,
                    "state": error.code
                    if isinstance(error, PolicyError)
                    and error.code in ("quota_exceeded", "paused", "grant_limit")
                    else "unavailable",
                }
            )
    request.outcomes = outcomes
    request.status = (
        "fulfilled" if outcomes and all("transfer_id" in o for o in outcomes) else "partial_or_unavailable"
    )
    request.save(update_fields=["outcomes", "status"])
    audit(contact.owner, "request.received", request.pk, request.status)
    return request


def receipt_fingerprint(transfer):
    return hashlib.sha256(f"{transfer.pk}:{transfer.provider_id}:{transfer.status}".encode()).hexdigest()[:12]
