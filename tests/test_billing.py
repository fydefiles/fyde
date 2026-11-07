import hashlib
import hmac
import json
import time
from datetime import timedelta
from unittest.mock import MagicMock, patch

import stripe
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from exchange.models import BillingEvent, CheckoutAttempt, Subscription, User
from exchange.policy import entitlement


@override_settings(
    DEBUG=True,
    STRIPE_API_KEY="rk_test_fixture_only",
    STRIPE_WEBHOOK_SECRET="fixture-webhook-secret",
    STRIPE_LIVE_ENABLED=False,
)
class BillingLifecycle(TestCase):
    databases = {"default", "company"}

    def setUp(self):
        self.owner = User.objects.create_user(
            username="billing@example.test",
            email="billing@example.test",
            password="Billing-password-724!",
            data_mode="fixture",
        )
        self.client.force_login(self.owner)
        self.api = MagicMock()
        self.api.v1.subscriptions.retrieve.return_value = self.observed()
        self.patcher = patch("exchange.billing.client", return_value=self.api)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.env = patch.dict(
            "os.environ",
            {"STRIPE_PRICE_PLUS": "price_fixture_plus", "STRIPE_PRICE_UNLIMITED": "price_fixture_unlimited"},
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def observed(self, status="active", price="price_fixture_plus", cancel=False):
        now = timezone.now()
        return stripe.StripeObject.construct_from(
            {
                "id": "sub_fixture",
                "customer": "cus_fixture",
                "status": status,
                "metadata": {"fyde_owner_id": str(self.owner.pk)},
                "livemode": False,
                "cancel_at_period_end": cancel,
                "items": {
                    "data": [
                        {
                            "price": {"id": price},
                            "current_period_start": int((now - timedelta(days=1)).timestamp()),
                            "current_period_end": int((now + timedelta(days=29)).timestamp()),
                        }
                    ]
                },
            },
            None,
        )

    def event(self, event_id, kind="customer.subscription.updated", *, signature=True, created=None):
        body = json.dumps(
            {
                "id": event_id,
                "type": kind,
                "created": created or int(time.time()),
                "livemode": False,
                "data": {"object": {"id": "sub_fixture"}},
            }
        ).encode()
        timestamp = int(time.time())
        digest = hmac.new(
            b"fixture-webhook-secret", f"{timestamp}.".encode() + body, hashlib.sha256
        ).hexdigest()
        header = f"t={timestamp},v1={digest}" if signature else "t=0,v1=forged"
        return self.client.post(
            reverse("stripe_webhook"), body, content_type="application/json", HTTP_STRIPE_SIGNATURE=header
        )

    def test_verified_duplicate_out_of_order_renewal_downgrade_cancellation_and_failed_payment(self):
        self.assertEqual(self.event("evt_initial").status_code, 200)
        self.assertEqual(entitlement(self.owner)[0], "plus")
        self.assertEqual(self.event("evt_initial").json()["duplicate"], True)
        self.assertEqual(BillingEvent.objects.count(), 1)
        self.api.v1.subscriptions.retrieve.return_value = self.observed(price="price_fixture_unlimited")
        self.assertEqual(self.event("evt_upgrade").status_code, 200)
        self.assertEqual(entitlement(self.owner)[0], "unlimited")
        self.api.v1.subscriptions.retrieve.return_value = self.observed(
            price="price_fixture_plus", cancel=True
        )
        self.assertEqual(self.event("evt_downgrade").status_code, 200)
        self.assertEqual(entitlement(self.owner)[0], "plus")
        self.assertTrue(Subscription.objects.get().cancel_at_period_end)
        self.api.v1.subscriptions.retrieve.return_value = self.observed(status="past_due")
        self.assertEqual(self.event("evt_payment_failed").status_code, 200)
        self.assertEqual(entitlement(self.owner)[0], "free")
        self.api.v1.subscriptions.retrieve.return_value = self.observed(status="active")
        self.assertEqual(self.event("evt_renewed").status_code, 200)
        self.assertEqual(entitlement(self.owner)[0], "plus")
        self.api.v1.subscriptions.retrieve.return_value = self.observed(status="canceled")
        self.assertEqual(self.event("evt_canceled", "customer.subscription.deleted").status_code, 200)
        self.assertEqual(entitlement(self.owner)[0], "free")
        # An older event still reconciles present provider state and cannot restore canceled entitlement.
        self.assertEqual(self.event("evt_old", created=int(time.time()) - 3600).status_code, 200)
        self.assertEqual(entitlement(self.owner)[0], "free")

    def test_forged_webhook_and_browser_success_cannot_grant_entitlement(self):
        self.assertEqual(self.event("evt_forged", signature=False).status_code, 400)
        self.assertEqual(BillingEvent.objects.count(), 0)
        self.assertEqual(self.client.get(reverse("dashboard") + "?checkout=received").status_code, 200)
        self.assertEqual(entitlement(self.owner)[0], "free")

    def test_sandbox_subscription_never_grants_live_customer_entitlement(self):
        self.event("evt_sandbox")
        self.owner.data_mode = "live"
        self.owner.save()
        self.assertEqual(entitlement(self.owner)[0], "free")

    def test_checkout_reuses_persisted_session_and_validates_experiment_price(self):
        self.api.v1.prices.retrieve.return_value = stripe.StripeObject.construct_from(
            {
                "currency": "usd",
                "unit_amount": 500,
                "active": True,
                "recurring": {"interval": "month", "interval_count": 1},
                "livemode": False,
            },
            None,
        )
        self.api.v1.checkout.sessions.create.return_value = stripe.StripeObject.construct_from(
            {"id": "cs_fixture", "url": "https://checkout.stripe.com/fixture"}, None
        )
        first = self.client.post(reverse("checkout", args=["plus"]))
        self.assertEqual(first.status_code, 302)
        self.assertEqual(first.url, "https://checkout.stripe.com/fixture")
        second = self.client.post(reverse("checkout", args=["plus"]))
        self.assertEqual(second.url, first.url)
        self.assertEqual(self.api.v1.checkout.sessions.create.call_count, 1)
        self.assertEqual(CheckoutAttempt.objects.count(), 1)
        self.assertEqual(entitlement(self.owner)[0], "free")
