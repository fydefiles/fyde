"""The recipient inbox references the original immutable version; it never copies or broadens access."""

from django.db import transaction
from django.utils import timezone

from .models import InboxItem, Notification, Transfer
from .policy import PolicyError, audit, check_transfer, settle_quota
from .recipients import account_for, matches_recipient, pending_for

RECEIVABLE = ("provider_accepted", "delivered", "test_available", "available_in_app", "accessed")


def deliver_to_inbox(transfer, recipient=None):
    check_transfer(transfer)
    recipient = recipient or account_for(transfer.contact, transfer.data_mode, transfer.grant.identity_kind)
    if recipient is None or not matches_recipient(recipient, transfer):
        return None
    existing = InboxItem.objects.filter(transfer=transfer).first()
    if existing and existing.recipient_id != recipient.pk:
        raise PolicyError(
            "recipient_identity_changed", "This delivery is bound to a different verified account."
        )
    item, created = InboxItem.objects.get_or_create(transfer=transfer, defaults={"recipient": recipient})
    if created:
        settle_quota(transfer, True)
        transfer.accepted_at = transfer.accepted_at or timezone.now()
        transfer.status = "accessed" if transfer.accessed_at else "available_in_app"
        transfer.save(update_fields=["accepted_at", "status"])
        Notification.objects.get_or_create(
            external_id=f"received/{transfer.pk}",
            defaults={
                "owner": recipient,
                "body": "A shared file is available in your Fyde inbox.",
                "link": "/app/received/",
            },
        )
        audit(transfer.owner, "transfer.inbox_delivered", transfer.pk, "verified_recipient_account")
    return item


def collect_received(user):
    if not user.is_authenticated:
        return
    ids = list(
        Transfer.objects.filter(
            pending_for(user),
            data_mode=user.data_mode,
            status__in=RECEIVABLE,
            revoked_at=None,
            expires_at__gt=timezone.now(),
            inbox_item__isnull=True,
        ).values_list("pk", flat=True)[:100]
    )
    for transfer_id in ids:
        try:
            with transaction.atomic():
                transfer = (
                    Transfer.objects.select_for_update()
                    .select_related("owner", "contact", "grant", "version__document")
                    .get(pk=transfer_id)
                )
                deliver_to_inbox(transfer, user)
        except PolicyError:
            continue


def can_download(user, transfer):
    item = InboxItem.objects.filter(transfer=transfer, recipient=user).first()
    if not item or not matches_recipient(user, transfer):
        raise PolicyError("denied", "This file is unavailable for this account.")
    check_transfer(transfer)
    return item
