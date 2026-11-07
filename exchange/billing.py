import os
from datetime import datetime, timezone as dt_timezone

import stripe
from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.shortcuts import redirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .models import BillingEvent, CheckoutAttempt, Subscription, User
from .policy import PolicyError, audit, plans


def client():
    key = settings.STRIPE_API_KEY
    if not key:
        raise PolicyError(
            "billing_not_configured", "Stripe is not configured. No checkout or charge was created."
        )
    if "_live_" in key and not settings.STRIPE_LIVE_ENABLED:
        raise PolicyError("live_billing_disabled", "Live billing needs explicit operator activation.")
    return stripe.StripeClient(key, max_network_retries=2)


def mode():
    return "live" if "_live_" in settings.STRIPE_API_KEY else "sandbox"


@login_required
@require_POST
def checkout(request, plan):
    try:
        config = plans()
        if plan not in ("plus", "unlimited"):
            raise PolicyError("unknown_plan", "Choose a paid plan from the pricing page.")
        api = client()
        price_id = os.environ.get(f"STRIPE_PRICE_{plan.upper()}", "")
        if not price_id:
            raise PolicyError(
                "price_not_configured", "The operator must configure the plan's Stripe price first."
            )
        price = api.v1.prices.retrieve(price_id)
        expected = config["plans"][plan]
        if (
            price.currency != "usd"
            or price.unit_amount != expected["monthly_usd"] * 100
            or not price.active
            or not price.recurring
            or price.recurring.interval != "month"
            or price.recurring.interval_count != 1
            or bool(price.livemode) != (mode() == "live")
        ):
            raise PolicyError("price_mismatch", "The configured Stripe price does not match this experiment.")
        with transaction.atomic():
            User.objects.select_for_update().get(pk=request.user.pk)
            sub, _ = Subscription.objects.get_or_create(owner=request.user)
            if sub.provider_subscription_id and sub.status not in ("canceled", "incomplete_expired"):
                raise PolicyError(
                    "subscription_exists", "Manage your existing subscription in the customer portal."
                )
            attempt, created = CheckoutAttempt.objects.select_for_update().get_or_create(
                owner=request.user, defaults={"plan": plan, "data_mode": mode()}
            )
            if not created and attempt.status in ("expired", "completed"):
                attempt.delete()
                attempt = CheckoutAttempt.objects.create(owner=request.user, plan=plan, data_mode=mode())
            if attempt.plan != plan or attempt.data_mode != mode():
                raise PolicyError(
                    "checkout_pending",
                    "An existing checkout must complete or expire before choosing another plan.",
                )
            if attempt.url:
                return redirect(attempt.url)
            # A persisted key lets uncertain requests resume without creating another Checkout Session.
            attempt_id = attempt.pk
        if attempt.created_at < timezone.now() - __import__("datetime").timedelta(hours=23):
            raise PolicyError(
                "checkout_reconciliation", "This checkout needs provider reconciliation before retrying."
            )
        session = api.v1.checkout.sessions.create(
            params={
                "mode": "subscription",
                "line_items": [{"price": price_id, "quantity": 1}],
                "customer_email": request.user.email,
                "client_reference_id": str(request.user.pk),
                "subscription_data": {"metadata": {"fyde_owner_id": str(request.user.pk), "fyde_plan": plan}},
                "metadata": {"fyde_owner_id": str(request.user.pk), "plan_version": config["version"]},
                "success_url": f"{settings.SITE_URL}/app/?checkout=received",
                "cancel_url": f"{settings.SITE_URL}/pricing/",
                "integration_identifier": "fyde_checkout_"
                + "".join(chr(97 + b % 26) for b in attempt_id.bytes[:8]),
            },
            options={"idempotency_key": f"fyde-checkout/{attempt_id}"},
        )
        CheckoutAttempt.objects.filter(pk=attempt_id).update(
            provider_id=session.id, url=session.url, status="open"
        )
        return redirect(session.url)
    except PolicyError as error:
        messages.error(request, str(error))
    except stripe.StripeError:
        messages.error(
            request,
            "Stripe could not confirm checkout. Retry this same checkout; entitlement has not changed.",
        )
    return redirect("pricing")


@login_required
@require_POST
def portal(request):
    try:
        api = client()
        sub = Subscription.objects.filter(owner=request.user).first()
        if not sub or not sub.provider_customer_id or sub.data_mode != mode():
            raise PolicyError("no_billing_account", "There is no billing account for this environment yet.")
        session = api.v1.billing_portal.sessions.create(
            params={"customer": sub.provider_customer_id, "return_url": f"{settings.SITE_URL}/app/#settings"}
        )
        return redirect(session.url)
    except PolicyError as error:
        messages.error(request, str(error))
    except stripe.StripeError:
        messages.error(request, "The billing portal is temporarily unavailable.")
    return redirect("dashboard")


def timestamp(value):
    return datetime.fromtimestamp(value, tz=dt_timezone.utc) if value else None


def reconcile_subscription(subscription_id, expected_owner_id=None):
    api = client()
    # Authoritative retrieval, rather than event arrival order, determines current entitlement.
    observed = api.v1.subscriptions.retrieve(subscription_id).to_dict()
    owner_id = observed.get("metadata", {}).get("fyde_owner_id")
    if not owner_id or (expected_owner_id and str(owner_id) != str(expected_owner_id)):
        raise PolicyError("billing_identity_mismatch", "Subscription identity could not be verified.")
    with transaction.atomic():
        owner = User.objects.select_for_update().get(pk=owner_id)
        # Retrieve inside the lock so another reconciliation cannot overwrite a newer observation.
        observed = api.v1.subscriptions.retrieve(subscription_id).to_dict()
        sub, _ = Subscription.objects.select_for_update().get_or_create(owner=owner)
        if (
            sub.provider_subscription_id
            and sub.provider_subscription_id != subscription_id
            and sub.status in ("active", "trialing")
        ):
            raise PolicyError(
                "multiple_subscriptions", "An operator must reconcile multiple subscription records."
            )
        items = observed.get("items", {}).get("data", [])
        if len(items) != 1:
            raise PolicyError(
                "unexpected_billing_items", "The subscription does not match the pricing experiment."
            )
        item = items[0]
        price = item.get("price", {})
        prices = {
            os.environ.get("STRIPE_PRICE_PLUS", ""): "plus",
            os.environ.get("STRIPE_PRICE_UNLIMITED", ""): "unlimited",
        }
        key = prices.get(price.get("id"))
        if not key or not price.get("id"):
            raise PolicyError("unknown_billing_price", "Unrecognized subscription price.")
        sub.plan = key
        sub.status = observed["status"]
        sub.provider_customer_id = observed["customer"]
        sub.provider_subscription_id = observed["id"]
        sub.period_start = timestamp(item.get("current_period_start") or observed.get("current_period_start"))
        sub.period_end = timestamp(item.get("current_period_end") or observed.get("current_period_end"))
        sub.cancel_at_period_end = observed.get("cancel_at_period_end", False)
        sub.plan_version = plans()["version"]
        sub.data_mode = "live" if observed["livemode"] else "sandbox"
        sub.save()
        audit(owner, "subscription.changed", sub.pk, sub.status, plan=key, mode=sub.data_mode)
    return sub


@csrf_exempt
@require_POST
def webhook(request):
    if not settings.STRIPE_WEBHOOK_SECRET or not settings.STRIPE_API_KEY:
        return HttpResponse("Billing webhook is not configured.", status=503)
    if len(request.body) > 1024 * 1024:
        return HttpResponse(status=413)
    try:
        event = stripe.Webhook.construct_event(
            request.body, request.headers.get("Stripe-Signature", ""), settings.STRIPE_WEBHOOK_SECRET
        )
    except (ValueError, stripe.SignatureVerificationError):
        return HttpResponse(status=400)
    if bool(event.livemode) != (mode() == "live") or (event.livemode and not settings.STRIPE_LIVE_ENABLED):
        return HttpResponse(status=400)
    record, _ = BillingEvent.objects.get_or_create(
        provider_event_id=event.id,
        defaults={
            "kind": event.type,
            "data_mode": "live" if event.livemode else "sandbox",
            "object_id": event.data.object.id,
            "occurred_at": timestamp(event.created),
        },
    )
    if record.status == "processed":
        return JsonResponse({"received": True, "duplicate": True})
    try:
        obj = event.data.object.to_dict()
        if event.type.startswith("customer.subscription."):
            reconcile_subscription(obj["id"])
        elif event.type == "checkout.session.completed":
            # Success redirects never grant access. Only verified provider state does.
            if obj.get("subscription"):
                reconcile_subscription(obj["subscription"], obj.get("client_reference_id"))
            CheckoutAttempt.objects.filter(provider_id=obj["id"]).update(status="completed")
        elif event.type == "checkout.session.expired":
            CheckoutAttempt.objects.filter(provider_id=obj["id"]).update(status="expired")
        elif event.type in ("invoice.paid", "invoice.payment_failed"):
            subscription_id = obj.get("subscription") or obj.get("parent", {}).get(
                "subscription_details", {}
            ).get("subscription")
            if subscription_id:
                reconcile_subscription(subscription_id)
        record.status = "processed"
        record.save(update_fields=["status"])
    except (stripe.StripeError, PolicyError, User.DoesNotExist):
        record.status = "retry_required"
        record.save(update_fields=["status"])
        return HttpResponse("Reconciliation pending.", status=503)
    return JsonResponse({"received": True})
