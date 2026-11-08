"""Receiving journeys protect the new default and its disclosure/metering boundaries.

External provider responses are fixtures; no email or SMS is sent by these checks.
"""

import re
import tempfile
import uuid
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

import httpx
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from exchange.delivery import ProviderRejected, process_mail, reconcile_transfer
from exchange.identity import issue_challenge
from exchange.models import (
    Challenge,
    Contact,
    Grant,
    InboxItem,
    Mail,
    PhoneBudget,
    Transfer,
    UsageEntry,
    User,
)
from exchange.policy import PolicyError, check_transfer, current_period, execution_binding, reverse_quota
from exchange.storage import add_file, blob_path, inspect_version
from exchange.transfers import change_endpoint, create_transfer, revoke_transfer


class ReceivingJourney(TestCase):
    databases = {"default", "company"}

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        config = override_settings(
            DEBUG=True,
            EMAIL_ADAPTER="local",
            SMS_ADAPTER="local",
            SCAN_ADAPTER="text_only",
            MEDIA_ROOT=Path(folder.name),
        )
        config.enable()
        self.addCleanup(config.disable)
        self.owner = User.objects.create_user(
            username="sender", email="sender@example.test", email_verified=True, data_mode="fixture"
        )
        self.recipient = User.objects.create_user(
            username="receiver", email="receiver@example.test", email_verified=True, data_mode="fixture"
        )
        self.version = inspect_version(
            add_file(self.owner, SimpleUploadedFile("Original.txt", b"Original fixture bytes."))
        )
        self.client.force_login(self.owner)
        self.receiver = Client()
        self.receiver.force_login(self.recipient)
        self.client.post(reverse("add_contact"), {"name": "Alex", "email": self.recipient.email})
        self.contact = Contact.objects.get(owner=self.owner)

    def send(self, **kwargs):
        return create_transfer(self.owner, self.version, self.contact, str(uuid.uuid4()), **kwargs)

    def verify(self, browser, challenge):
        message = Mail.objects.get(idempotency_key=f"challenge/{challenge.pk}")
        path = urlparse(re.search(r"https?://\S+", message.body).group()).path
        code = re.search(r"code is (\d{6})", message.body).group(1)
        return browser.post(path, {"code": code})

    def download(self, transfer):
        return self.receiver.post(
            reverse("received_download", args=[InboxItem.objects.get(transfer=transfer).pk])
        )

    def test_default_command_delivers_exact_version_without_external_provider_and_charges_once(self):
        operation = str(uuid.uuid4())
        with patch("httpx.post") as provider:
            response = self.client.post(
                reverse("command"), {"command": "Send my Original to Alex", "operation_id": operation}
            )
            self.assertEqual(response.status_code, 302)
            provider.assert_not_called()
        transfer = Transfer.objects.get()
        self.assertEqual(transfer.channel, "in_app")
        self.assertEqual(transfer.status, "available_in_app")
        self.assertEqual(Mail.objects.count(), 0)  # Adding a known app contact sends no unsolicited email.
        self.assertContains(self.receiver.get(reverse("received")), "Original.txt")
        self.assertNotContains(self.client.get(reverse("received")), "Original.txt")
        self.assertEqual(
            self.client.post(reverse("received_download", args=[transfer.inbox_item.pk])).status_code, 404
        )
        anonymous = Client()
        self.assertNotContains(anonymous.get(reverse("access", args=[transfer.pk])), "Original.txt")
        self.assertEqual(
            anonymous.post(reverse("access", args=[transfer.pk]), {"action": "verify"}).status_code, 403
        )
        newer = inspect_version(
            add_file(
                self.owner,
                SimpleUploadedFile("New.txt", b"New fixture bytes."),
                document_id=self.version.document_id,
            )
        )
        self.assertNotEqual(newer.pk, transfer.version_id)
        for _ in range(2):
            downloaded = self.download(transfer)
            self.assertEqual(b"".join(downloaded.streaming_content), b"Original fixture bytes.")
        repeat = create_transfer(self.owner, self.version, self.contact, operation)
        self.assertEqual(repeat.pk, transfer.pk)
        self.assertEqual(current_period(self.owner).consumed, 1)
        self.assertEqual(current_period(self.owner).reserved, 0)
        self.assertEqual(current_period(self.owner).bandwidth_used, self.version.size * 2)
        self.assertEqual(UsageEntry.objects.filter(transfer=transfer, kind="accepted").count(), 1)
        reverse_quota(transfer)
        self.assertEqual(current_period(self.owner).consumed, 1)

    def test_default_and_command_channel_overrides_are_bound_to_permission(self):
        self.client.post(reverse("settings_action"), {"action": "default_channel", "channel": "email"})
        response = self.client.post(
            reverse("command"), {"command": "Send Original to Alex", "operation_id": uuid.uuid4()}
        )
        self.assertEqual(response.status_code, 302)
        email = Transfer.objects.get()
        self.assertEqual(email.channel, "email")
        response = self.client.post(
            reverse("command"),
            {"command": "Send Original to Alex in the app", "channel": "email", "operation_id": uuid.uuid4()},
        )
        self.assertEqual(response.status_code, 302)
        native = Transfer.objects.exclude(pk=email.pk).get()
        self.assertEqual(native.channel, "in_app")
        # A retry cannot reuse an operation with a different channel.
        with self.assertRaises(PolicyError):
            create_transfer(self.owner, self.version, self.contact, native.operation_id, channel="phone")
        self.client.post(reverse("settings_action"), {"action": "default_channel", "channel": "unexpected"})
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.default_delivery_channel, "email")
        native.channel = "email"
        with self.assertRaises(PolicyError):
            check_transfer(native)

    def test_native_requires_verified_same_mode_identity_and_rejects_conflicting_endpoints(self):
        self.recipient.email_verified = False
        self.recipient.save()
        with self.assertRaises(PolicyError) as error:
            self.send()
        self.assertEqual(error.exception.code, "recipient_not_on_fyde")
        self.recipient.email_verified, self.recipient.data_mode = True, "live"
        self.recipient.save()
        with self.assertRaises(PolicyError):
            self.send()
        self.recipient.data_mode = "fixture"
        self.recipient.save()
        User.objects.create_user(
            username="other-phone",
            email="other@example.test",
            phone="+14155550123",
            phone_verified_at=timezone.now(),
            email_verified=True,
            data_mode="fixture",
        )
        self.contact.phone = "+14155550123"
        self.contact.save()
        with self.assertRaises(PolicyError) as conflict:
            self.send()
        self.assertEqual(conflict.exception.code, "recipient_identity_conflict")
        self.assertEqual(Transfer.objects.count(), 0)

    def test_receiving_download_rechecks_pause_revocation_expiry_and_original_hash(self):
        transfer = self.send()
        self.owner.sharing_paused = True
        self.owner.save()
        self.assertEqual(self.download(transfer).status_code, 403)
        self.owner.sharing_paused = False
        self.owner.save()
        blob_path(self.version).write_bytes(b"Tampered bytes.")
        self.assertEqual(self.download(transfer).status_code, 404)
        blob_path(self.version).write_bytes(b"Original fixture bytes.")
        self.assertEqual(current_period(self.owner).bandwidth_used, 0)
        revoke_transfer(self.owner, transfer.pk)
        self.assertEqual(self.download(transfer).status_code, 403)
        expired = self.send()
        Transfer.objects.filter(pk=expired.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.download(expired).status_code, 403)
        changed = self.send()
        change_endpoint(self.owner, self.contact.pk, "changed@example.test")
        self.assertEqual(self.download(changed).status_code, 403)
        self.assertContains(self.receiver.get(reverse("received")), "Unavailable")

    def test_notification_failure_does_not_remove_received_file_or_reverse_its_send(self):
        transfer = self.send(channel="email")
        message = Mail.objects.get(transfer=transfer)
        with patch("exchange.delivery.LocalEmail.send", side_effect=ProviderRejected("fixture-rejected")):
            process_mail(message.pk)
        transfer.refresh_from_db()
        self.assertEqual(transfer.status, "available_in_app")
        self.assertEqual(transfer.quota_state, "consumed")
        self.assertEqual(Mail.objects.get(pk=message.pk).status, "failed")
        self.assertEqual(self.download(transfer).status_code, 200)
        self.assertEqual(current_period(self.owner).consumed, 1)
        with override_settings(
            EMAIL_ADAPTER="resend",
            RESEND_API_KEY="fixture",
            EMAIL_FROM="sender@example.test",
            SITE_URL="https://example.test",
        ):
            Transfer.objects.filter(pk=transfer.pk).update(provider_id="fixture-provider", data_mode="live")
            transfer.refresh_from_db()
            with patch("exchange.delivery.ResendEmail.reconcile", return_value="bounced"):
                self.assertEqual(reconcile_transfer(transfer), "bounced")
        self.assertEqual(current_period(self.owner).consumed, 1)

    def test_phone_link_is_verified_and_received_sms_file_appears_only_for_linked_account(self):
        contact = Contact.objects.create(owner=self.owner, name="Phone Alex", phone="+14155550123")
        challenge = issue_challenge(self.owner, "contact", contact=contact, channel="phone")
        self.assertEqual(self.verify(Client(), challenge).status_code, 200)
        contact.refresh_from_db()
        self.assertIsNotNone(contact.phone_verified_at)
        self.assertIsNone(contact.verified_at)
        transfer = create_transfer(self.owner, self.version, contact, str(uuid.uuid4()), channel="phone")
        message = Mail.objects.get(transfer=transfer)
        self.assertEqual(message.destination, contact.phone)
        process_mail(message.pk)
        self.assertNotContains(self.receiver.get(reverse("received")), "Original.txt")
        guest = Client()
        self.assertEqual(
            guest.post(reverse("access", args=[transfer.pk]), {"action": "verify"}).status_code, 200
        )
        self.verify(guest, Challenge.objects.get(scope="access", transfer=transfer))
        self.assertContains(guest.get(reverse("access", args=[transfer.pk])), "Original.txt")
        # Matching a contact label or knowing the number is not enough to claim its inbox.
        self.receiver.post(reverse("settings_action"), {"action": "phone_identity", "phone": contact.phone})
        self.assertNotContains(self.receiver.get(reverse("received")), "Original.txt")
        self.verify(self.receiver, Challenge.objects.get(owner=self.recipient, scope="phone_identity"))
        self.assertContains(self.receiver.get(reverse("received")), "Original.txt")
        self.assertEqual(self.download(transfer).status_code, 200)
        self.assertEqual(current_period(self.owner).consumed, 1)
        native = create_transfer(self.owner, self.version, contact, str(uuid.uuid4()))
        self.assertEqual(native.channel, "in_app")
        self.assertEqual(native.grant.identity_kind, "phone")
        self.assertEqual(native.inbox_item.recipient, self.recipient)
        duplicate = issue_challenge(self.owner, "phone_identity", channel="phone", destination=contact.phone)
        self.assertEqual(self.verify(self.client, duplicate).status_code, 400)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.phone, "")

    def test_standing_request_uses_the_granted_channel_and_exact_identity(self):
        self.contact.phone = "+14155550123"
        self.contact.save(update_fields=["phone"])
        response = self.client.post(
            reverse("create_grant"),
            {
                "version_id": self.version.pk,
                "contact_id": self.contact.pk,
                "channel": "in_app",
                "days": 1,
                "max_requests": 2,
                "purpose": "Case",
            },
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Grant.objects.get().channel, "in_app")
        guest = Client()
        self.verify(guest, issue_challenge(self.owner, "request", contact=self.contact, channel="phone"))
        self.assertNotContains(guest.get(reverse("incoming", args=[self.contact.pk])), "Original")
        guest.post(
            reverse("incoming", args=[self.contact.pk]),
            {"versions": [self.version.pk], "purpose": "Case", "operation_id": uuid.uuid4()},
        )
        self.assertEqual(Transfer.objects.count(), 0)  # Phone proof cannot spend an email-bound grant.
        page = self.receiver.get(reverse("incoming", args=[self.contact.pk]))
        self.assertContains(page, "Original")
        response = self.receiver.post(
            reverse("incoming", args=[self.contact.pk]),
            {"versions": [self.version.pk], "purpose": "Case", "operation_id": uuid.uuid4()},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Transfer.objects.get().status, "available_in_app")
        self.assertEqual(Mail.objects.filter(transfer__isnull=False).count(), 0)

    @override_settings(
        EMAIL_ADAPTER="resend",
        SMS_ADAPTER="twilio",
        TWILIO_ACCOUNT_SID="AC" + "a" * 32,
        TWILIO_AUTH_TOKEN="fixture-only",
        SMS_FROM="+14155550000",
        SITE_URL="https://example.test",
        SMS_UNIT_COST_USD="0.01",
        SMS_DAILY_BUDGET_USD="1",
        SMS_DAILY_LIMIT=10,
    )
    def test_live_sms_adapter_reserves_segment_cost_and_never_retries_unknown_send(self):
        self.owner.data_mode = "live"
        self.owner.save()
        contact = Contact.objects.create(
            owner=self.owner, name="SMS guest", phone="+14155550199", phone_verified_at=timezone.now()
        )
        transfer = create_transfer(self.owner, self.version, contact, str(uuid.uuid4()), channel="phone")
        message = Mail.objects.get(transfer=transfer)
        with patch("exchange.sms.httpx.post", side_effect=httpx.ReadTimeout("fixture")) as send:
            process_mail(message.pk)
            self.assertEqual(send.call_count, 1)
            self.assertEqual(send.call_args.kwargs["data"]["To"], contact.phone)
            Mail.objects.filter(pk=message.pk).update(next_attempt_at=timezone.now())
            process_mail(message.pk)
            self.assertEqual(send.call_count, 1)
        message.refresh_from_db()
        self.assertEqual(message.status, "reconciliation_required")
        self.assertEqual(PhoneBudget.objects.get().reserved_count, 1)
        self.assertGreater(PhoneBudget.objects.get().reserved_usd, Decimal("0.01"))
        transfer.refresh_from_db()
        self.assertEqual(transfer.quota_state, "reserved")
        accepted = create_transfer(self.owner, self.version, contact, str(uuid.uuid4()), channel="phone")
        response = httpx.Response(201, json={"sid": "SM" + "b" * 32})
        with patch("exchange.sms.httpx.post", return_value=response):
            process_mail(Mail.objects.get(transfer=accepted).pk)
        accepted.refresh_from_db()
        self.assertEqual(accepted.status, "provider_accepted")
        self.assertEqual(accepted.provider_id, "SM" + "b" * 32)
        with patch("exchange.sms.TwilioPhone.reconcile", return_value="undelivered"):
            reconcile_transfer(accepted)
            reconcile_transfer(accepted)
        self.assertEqual(current_period(self.owner).consumed, 0)
        self.assertEqual(UsageEntry.objects.filter(transfer=accepted, kind="reversed").count(), 1)
        guarded = create_transfer(self.owner, self.version, contact, str(uuid.uuid4()), channel="phone")
        with override_settings(SMS_DAILY_LIMIT=0), patch("exchange.sms.httpx.post") as send:
            process_mail(Mail.objects.get(transfer=guarded).pk)
            send.assert_not_called()
        self.assertEqual(Mail.objects.get(transfer=guarded).failure_code, "sms_budget_missing")
        self.assertEqual(PhoneBudget.objects.get().reserved_count, 2)
        with override_settings(SMS_ADAPTER="disabled"):
            with self.assertRaises(PolicyError) as disconnected:
                create_transfer(self.owner, self.version, contact, str(uuid.uuid4()), channel="phone")
            self.assertEqual(disconnected.exception.code, "sms_disabled")
        with override_settings(SMS_ADAPTER="local"):
            with self.assertRaises(PolicyError):
                issue_challenge(self.owner, "phone_identity", channel="phone", destination=contact.phone)

    def test_legacy_email_binding_still_downloads_and_cannot_switch_channels(self):
        transfer = self.send(channel="email")
        # Simulate an existing pre-inbox transfer, whose binding omitted new channel/phone fields.
        InboxItem.objects.filter(transfer=transfer).delete()
        transfer.binding_version, transfer.status = 1, "test_available"
        transfer.binding = execution_binding(transfer)
        transfer.save()
        guest = Client()
        self.verify(guest, issue_challenge(self.owner, "access", contact=self.contact, transfer=transfer))
        response = guest.post(reverse("access", args=[transfer.pk]), {"action": "download"})
        self.assertEqual(b"".join(response.streaming_content), b"Original fixture bytes.")
        transfer.channel = "in_app"
        with self.assertRaises(PolicyError):
            check_transfer(transfer)
