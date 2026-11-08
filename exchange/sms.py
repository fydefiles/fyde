"""SMS carries a verified download link. It is not an attachment or an iMessage integration."""

import re
import math
from decimal import Decimal, InvalidOperation

import httpx
from django.conf import settings
from django.utils import timezone

from .models import PhoneBudget
from .policy import PolicyError


class LocalPhone:
    mode = "fixture"
    supports_idempotent_retry = False

    def capabilities(self):
        return {"state": "sandbox", "sends_sms": False}

    def send(self, message):
        if not settings.DEBUG:
            raise PolicyError(
                "local_adapter_forbidden", "The local SMS outbox is disabled outside development."
            )
        return f"fixture-sms-{message.pk}"


class TwilioPhone:
    mode = "live"
    # The Messages endpoint does not establish a provider idempotency contract here.
    supports_idempotent_retry = False

    def capabilities(self):
        configured = (
            re.fullmatch(r"AC[a-fA-F0-9]{32}", settings.TWILIO_ACCOUNT_SID)
            and settings.TWILIO_AUTH_TOKEN
            and re.fullmatch(r"\+[1-9]\d{7,14}", settings.SMS_FROM)
            and settings.SITE_URL.startswith("https://")
        )
        return {"state": "ready" if configured else "not_configured", "sends_sms": bool(configured)}

    def send(self, message):
        from .delivery import ProviderRejected, ProviderUncertain

        if self.capabilities()["state"] != "ready":
            raise PolicyError(
                "sms_not_configured", "Connect an authorized SMS sender and public HTTPS origin first."
            )
        try:
            response = httpx.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json",
                auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
                data={"To": message.destination, "From": settings.SMS_FROM, "Body": message.body},
                timeout=15,
            )
        except httpx.HTTPError:
            raise ProviderUncertain("sms_outcome_uncertain") from None
        if response.status_code >= 500:
            raise ProviderUncertain("sms_outcome_uncertain")
        if not response.is_success:
            raise ProviderRejected(f"sms_provider_{response.status_code}")
        try:
            sid = response.json()["sid"]
            if not re.fullmatch(r"SM[a-fA-F0-9]{32}", sid):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            raise ProviderUncertain("invalid_sms_response") from None
        return sid

    def reconcile(self, provider_id):
        if not re.fullmatch(r"SM[a-fA-F0-9]{32}", provider_id):
            raise PolicyError(
                "invalid_provider_id", "A valid SMS provider ID is required for reconciliation."
            )
        response = httpx.get(
            f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages/{provider_id}.json",
            auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
            timeout=15,
        )
        response.raise_for_status()
        return response.json().get("status", "unknown")


def adapter():
    if settings.SMS_ADAPTER == "local":
        return LocalPhone()
    if settings.SMS_ADAPTER == "twilio":
        return TwilioPhone()
    raise PolicyError("sms_disabled", "Phone delivery is not connected. Choose Fyde or email instead.")


def readiness():
    try:
        return adapter().capabilities()
    except PolicyError:
        return {"state": "disabled", "sends_sms": False}


def reserve_budget(message):
    if message.budget_reserved:
        return
    if len(message.body) > 480:
        raise PolicyError("sms_too_long", "Phone notifications are limited to 480 characters.")
    try:
        unit, cap = Decimal(settings.SMS_UNIT_COST_USD), Decimal(settings.SMS_DAILY_BUDGET_USD)
    except InvalidOperation:
        raise PolicyError(
            "sms_budget_missing",
            "Set a conservative per-message SMS cost, daily budget and daily count limit.",
        ) from None
    if not unit.is_finite() or not cap.is_finite() or unit <= 0 or cap <= 0 or settings.SMS_DAILY_LIMIT <= 0:
        raise PolicyError(
            "sms_budget_missing", "Positive SMS cost, daily budget and daily count limit are required."
        )
    # Reserve as Unicode multipart SMS even for ASCII. The configured per-segment
    # estimate must include destination-specific carrier charges; it is not an invoice.
    estimate = unit * (1 if len(message.body) <= 70 else math.ceil(len(message.body) / 67))
    budget, _ = PhoneBudget.objects.select_for_update().get_or_create(date=timezone.now().date())
    if budget.reserved_count >= settings.SMS_DAILY_LIMIT or budget.reserved_usd + estimate > cap:
        raise PolicyError(
            "sms_budget_exceeded", "Phone notifications are paused at the configured daily budget."
        )
    budget.reserved_count += 1
    budget.reserved_usd += estimate
    budget.save(update_fields=["reserved_count", "reserved_usd"])
    message.budget_reserved = True
