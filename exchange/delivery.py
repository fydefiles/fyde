from datetime import timedelta
from decimal import Decimal, InvalidOperation

import httpx
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import EmailBudget, InboxItem, Mail, Transfer
from .policy import PolicyError, audit, check_transfer, reverse_quota, settle_quota


class ProviderUncertain(Exception):
    pass


class ProviderRejected(Exception):
    pass


class LocalEmail:
    mode = "fixture"
    supports_idempotent_retry = True

    def capabilities(self):
        return {"state": "sandbox", "recipient_verification": "local fixture only", "sends_email": False}

    def send(self, mail):
        if not settings.DEBUG:
            raise PolicyError("local_adapter_forbidden", "The local outbox is disabled outside development.")
        return f"fixture-{mail.pk}"


class ResendEmail:
    mode = "live"
    supports_idempotent_retry = True

    def capabilities(self):
        ready = bool(
            settings.RESEND_API_KEY and settings.EMAIL_FROM and settings.SITE_URL.startswith("https://")
        )
        return {
            "state": "ready" if ready else "not_configured",
            "sends_email": ready,
            "idempotency_window_hours": 24,
        }

    def send(self, mail):
        if self.capabilities()["state"] != "ready":
            raise PolicyError(
                "email_not_configured", "Configure Resend, a verified sender, and a public HTTPS origin."
            )
        try:
            response = httpx.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                    "Idempotency-Key": mail.idempotency_key,
                },
                json={
                    "from": settings.EMAIL_FROM,
                    "to": [mail.destination],
                    "subject": mail.subject,
                    "text": mail.body,
                },
                timeout=15,
            )
        except httpx.HTTPError:
            raise ProviderUncertain("provider_timeout") from None
        if response.status_code >= 500 or response.status_code in (409, 429):
            raise ProviderUncertain(f"provider_{response.status_code}")
        if not response.is_success:
            raise ProviderRejected(f"provider_{response.status_code}")
        try:
            provider_id = response.json()["id"]
            if not isinstance(provider_id, str) or not provider_id:
                raise ValueError
            return provider_id[:100]
        except (ValueError, KeyError, TypeError):
            raise ProviderUncertain("invalid_provider_response") from None

    def reconcile(self, provider_id):
        response = httpx.get(
            f"https://api.resend.com/emails/{provider_id}",
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            timeout=15,
        )
        response.raise_for_status()
        return response.json().get("last_event", "unknown")


def adapter(channel="email"):
    if channel == "phone":
        from .sms import adapter as phone_adapter

        return phone_adapter()
    if settings.EMAIL_ADAPTER == "local":
        return LocalEmail()
    if settings.EMAIL_ADAPTER == "resend":
        return ResendEmail()
    raise PolicyError("email_disabled", "Email sending is disabled. Configure a delivery provider.")


def readiness(channel="email"):
    try:
        return adapter(channel).capabilities()
    except PolicyError:
        return {"state": "disabled", "sends_sms" if channel == "phone" else "sends_email": False}


def reserve_email_budget(mail):
    if mail.budget_reserved:
        return
    try:
        unit = Decimal(settings.EMAIL_UNIT_COST_USD)
        cap = Decimal(settings.EMAIL_DAILY_BUDGET_USD)
    except (InvalidOperation, ValueError):
        raise PolicyError(
            "email_budget_missing", "Set a delivery cost estimate and daily budget before live sending."
        ) from None
    if (
        not unit.is_finite()
        or not cap.is_finite()
        or unit <= 0
        or cap <= 0
        or settings.EXTERNAL_EMAIL_DAILY_LIMIT <= 0
    ):
        raise PolicyError(
            "email_budget_missing", "Positive email cost, daily budget, and daily count limit are required."
        )
    budget, _ = EmailBudget.objects.select_for_update().get_or_create(date=timezone.now().date())
    if budget.reserved_count >= settings.EXTERNAL_EMAIL_DAILY_LIMIT or budget.reserved_usd + unit > cap:
        raise PolicyError("email_budget_exceeded", "Email sending paused at the configured daily budget.")
    budget.reserved_count += 1
    budget.reserved_usd += unit
    budget.save(update_fields=["reserved_count", "reserved_usd"])
    mail.budget_reserved = True
    # This remains an estimate, never represented as an observed invoice cost.


def process_mail(mail_id):
    with transaction.atomic():
        mail = Mail.objects.select_for_update().get(pk=mail_id)
        now = timezone.now()
        if mail.status not in ("queued", "retry", "uncertain", "sending"):
            return False
        if mail.lease_until and mail.lease_until > now:
            return False
        if mail.next_attempt_at > now:
            return False
        transfer = None
        try:
            provider = adapter(mail.channel)
            if mail.data_mode != provider.mode:
                raise PolicyError(
                    "mode_changed", "The adapter mode changed; this operation requires reconciliation."
                )
            if mail.transfer_id:
                transfer = (
                    Transfer.objects.select_for_update()
                    .select_related(
                        "owner",
                        "version__document",
                        "contact",
                        "grant__owner",
                        "grant__version__document",
                        "grant__contact",
                    )
                    .get(pk=mail.transfer_id)
                )
                check_transfer(transfer)
            if (
                (mail.attempts and not provider.supports_idempotent_retry)
                or mail.attempts >= 3
                or (mail.first_attempt_at and mail.first_attempt_at < now - timedelta(hours=23))
            ):
                mail.status = "reconciliation_required"
                mail.failure_code = (
                    "sms_reconciliation_required"
                    if mail.channel == "phone"
                    else "idempotency_window_or_attempt_limit"
                )
                mail.save(update_fields=["status", "failure_code"])
                if transfer and not InboxItem.objects.filter(transfer=transfer).exists():
                    transfer.status = "uncertain"
                    transfer.save(update_fields=["status"])
                return True
            if provider.mode == "live":
                if mail.channel == "phone":
                    from .sms import reserve_budget

                    reserve_budget(mail)
                else:
                    reserve_email_budget(mail)
            mail.attempts += 1
            mail.first_attempt_at = mail.first_attempt_at or now
            mail.lease_until = now + timedelta(minutes=2)
            mail.status = "sending"
            mail.save()
        except PolicyError as error:
            mail.status, mail.failure_code = "blocked", error.code
            mail.save(update_fields=["status", "failure_code"])
            if transfer and not InboxItem.objects.filter(transfer=transfer).exists():
                transfer.status, transfer.failure_code = "blocked", error.code
                # Authorization failures are terminal; configuration blocks retain reservations for safe resumption.
                if (
                    error.code in {"revoked_or_expired", "binding_changed", "denied", "quarantined"}
                    and not mail.first_attempt_at
                ):
                    settle_quota(transfer, False)
                transfer.save(update_fields=["status", "failure_code"])
            return True
    # Persisted intent precedes the external side effect. Provider idempotency protects bounded recovery.
    outcome, provider_id, failure = "accepted", "", ""
    try:
        provider_id = provider.send(mail)
        if provider.mode == "fixture":
            outcome = "fixture_ready"
    except ProviderUncertain as error:
        outcome, failure = "uncertain", str(error)
    except (ProviderRejected, PolicyError) as error:
        outcome = "failed" if isinstance(error, ProviderRejected) else "blocked"
        failure = error.code if isinstance(error, PolicyError) else str(error)
    with transaction.atomic():
        mail = Mail.objects.select_for_update().get(pk=mail_id)
        mail.status, mail.provider_id, mail.failure_code = outcome, provider_id, failure
        mail.lease_until = None
        mail.next_attempt_at = timezone.now() + timedelta(minutes=5)
        mail.save()
        if mail.transfer_id:
            transfer = Transfer.objects.select_for_update().get(pk=mail.transfer_id)
            transfer.status = (
                "revoked"
                if transfer.revoked_at
                else "accessed"
                if transfer.accessed_at
                else "available_in_app"
                if InboxItem.objects.filter(transfer=transfer).exists()
                else {"accepted": "provider_accepted", "fixture_ready": "test_available"}.get(
                    outcome, outcome
                )
            )
            transfer.provider_id, transfer.failure_code = provider_id, failure
            if outcome in ("accepted", "fixture_ready"):
                transfer.accepted_at = transfer.accepted_at or timezone.now()
                settle_quota(transfer, True)
            elif outcome == "failed":
                settle_quota(transfer, False)
            transfer.save()
            if outcome in ("accepted", "fixture_ready") and not transfer.revoked_at:
                from .inbox import deliver_to_inbox

                try:
                    deliver_to_inbox(transfer)
                except PolicyError:
                    pass
            audit(transfer.owner, f"transfer.{transfer.status}", transfer.pk, transfer.status)
    return True


def deliver_pending(limit=25):
    now = timezone.now()
    ids = list(
        Mail.objects.filter(status__in=["queued", "retry", "uncertain", "sending"], next_attempt_at__lte=now)
        .filter(Q(lease_until=None) | Q(lease_until__lte=now))
        .order_by("created_at")
        .values_list("pk", flat=True)[:limit]
    )
    return sum(process_mail(pk) for pk in ids)


def reconcile_transfer(transfer):
    if not transfer.provider_id or transfer.data_mode != "live" or transfer.channel == "in_app":
        return "not_reconcilable"
    provider = adapter(transfer.channel)
    if provider.mode != "live" or provider.capabilities()["state"] != "ready":
        return "not_reconcilable"
    event = provider.reconcile(transfer.provider_id)
    with transaction.atomic():
        transfer = Transfer.objects.select_for_update().get(pk=transfer.pk)
        has_inbox = InboxItem.objects.filter(transfer=transfer).exists()
        if event in ("bounced", "failed", "suppressed", "undelivered", "canceled"):
            reverse_quota(transfer)
            Mail.objects.filter(transfer=transfer).update(status="failed", failure_code=f"provider_{event}")
            if not transfer.accessed_at and not has_inbox:
                Transfer.objects.filter(pk=transfer.pk, revoked_at=None).update(
                    status="failed", failure_code=f"provider_{event}"
                )
        elif event == "delivered":
            Mail.objects.filter(transfer=transfer).update(status="delivered")
            if not has_inbox:
                Transfer.objects.filter(pk=transfer.pk, accessed_at=None, revoked_at=None).update(
                    status="delivered"
                )
    return event
