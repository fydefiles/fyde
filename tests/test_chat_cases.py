"""Cross-client journeys for chat, onboarding and unattended customer case requests.

These synthetic files and accounts do not establish live email, professional credentials or store distribution.
"""

import hashlib
import re
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlparse

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from exchange.customer_access import issue_token
from exchange.delegation import create_policy
from exchange.models import (
    ChatExchange,
    Contact,
    CustomerToken,
    Document,
    FileVersion,
    InboxItem,
    Mail,
    Matter,
    StandingPolicy,
    Transfer,
    User,
)
from exchange.policy import current_period
from exchange.setup import classify_document
from exchange.storage import add_file, inspect_version
from exchange.transfers import change_endpoint, create_transfer


class ChatAndCaseJourney(TestCase):
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
            username="case-owner",
            email="owner@example.test",
            first_name="Sample owner",
            email_verified=True,
            data_mode="fixture",
            password="Synthetic-case-728!",
        )
        self.lawyer = User.objects.create_user(
            username="case-lawyer",
            email="lawyer@example.test",
            first_name="Sample lawyer",
            email_verified=True,
            data_mode="fixture",
            password="Synthetic-case-728!",
        )
        self.contact = Contact.objects.create(
            owner=self.owner, name="Alex", email=self.lawyer.email, relationship="lawyer"
        )
        self.matter = Matter.objects.create(owner=self.owner, name="Immigration case")
        self.other = Matter.objects.create(owner=self.owner, name="Unrelated project")
        _, self.owner_key = issue_token(self.owner)
        _, self.lawyer_key = issue_token(self.lawyer)

    def post(self, path, data, key=None, client=None):
        return (client or self.client).post(
            path, data, content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {key or self.owner_key}"
        )

    def file(
        self,
        name="Passport.txt",
        content=b"Synthetic passport fixture.",
        matter=None,
        kind="passport",
        sensitive=False,
        document=None,
    ):
        v = inspect_version(
            add_file(
                self.owner, SimpleUploadedFile(name, content), document_id=document.pk if document else None
            )
        )
        classify_document(
            self.owner,
            v.document,
            matter_id=(matter or self.matter).pk,
            document_type=kind,
            sensitive=sensitive,
        )
        return v

    def policy(self, **kwargs):
        return create_policy(
            self.owner,
            contact_id=self.contact.pk,
            matter_id=self.matter.pk,
            operation_id=str(uuid.uuid4()),
            types=["*"],
            **kwargs,
        )

    def agent(self, policy):
        response = self.post(
            "/api/v1/credentials/",
            {"policy_id": str(policy.pk), "name": "Synthetic requester"},
            self.lawyer_key,
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["token"]

    def request_files(self, key, **kwargs):
        return self.post("/api/agents/v1/requests/", {"operation_id": str(uuid.uuid4()), **kwargs}, key)

    def test_mobile_signup_bulk_setup_and_exact_agent_delivery_needs_no_owner_session(self):
        signup = self.post(
            "/api/v1/signup/",
            {"name": "New sender", "email": "new@example.test", "password": "Synthetic-new-728!"},
        )
        self.assertEqual(signup.status_code, 200, signup.content)
        key = signup.json()["token"]
        owner = User.objects.get(email="new@example.test")
        self.assertIsNone(owner.onboarding_completed_at)
        challenge = Mail.objects.get(owner=owner, idempotency_key__startswith="challenge/")
        code = re.search(r"code is (\d{6})", challenge.body).group(1)
        self.assertEqual(
            Client()
            .post(urlparse(re.search(r"https?://\S+", challenge.body).group()).path, {"code": code})
            .status_code,
            200,
        )
        case = self.post("/api/v1/matters/", {"name": "Immigration case"}, key).json()["id"]
        contact = self.post(
            "/api/v1/contacts/", {"name": "Alex", "email": self.lawyer.email, "relationship": "lawyer"}, key
        ).json()["id"]
        uploaded = []
        for name in ("Passport.txt", "Visa.txt"):
            response = self.client.post(
                "/api/v1/upload/",
                {
                    "file": SimpleUploadedFile(name, b"Only a synthetic case fixture."),
                    "matter_id": case,
                    "document_type": "passport",
                },
                HTTP_AUTHORIZATION=f"Bearer {key}",
            )
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()["file"]["state"], "quarantined")
            uploaded.append(FileVersion.objects.get(pk=response.json()["file"]["id"]))
        enabled = self.post(
            "/api/v1/policies/",
            {
                "operation_id": str(uuid.uuid4()),
                "contact_id": contact,
                "matter_id": case,
                "types": ["*"],
                "future_files": True,
                "future_versions": True,
                "confirm": True,
            },
            key,
        )
        self.assertEqual(enabled.status_code, 200, enabled.content)
        policy = StandingPolicy.objects.get(pk=enabled.json()["policy"]["id"])
        agent = self.agent(policy)
        self.assertEqual(self.request_files(agent).json()["files"], [])  # No quarantined bytes released.
        for version in uploaded:
            inspect_version(version)
        self.post("/api/v1/setup/complete/", {}, key)
        owner.refresh_from_db()
        self.assertIsNotNone(owner.onboarding_completed_at)
        # Only the recipient's scoped credential is present at fulfillment; no owner login or approval call.
        received = self.request_files(agent).json()
        self.assertEqual(len(received["files"]), 2)
        for file in received["files"]:
            response = Client().get(file["download_url"], HTTP_AUTHORIZATION=f"Bearer {agent}")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(hashlib.sha256(b"".join(response.streaming_content)).hexdigest(), file["sha256"])
        self.assertEqual(current_period(owner).consumed, 2)
        self.assertEqual(Mail.objects.filter(transfer__owner=owner).count(), 0)

    def test_case_boundary_sensitive_files_and_agent_authority_are_enforced(self):
        passport = self.file()
        self.file("Tax.txt", matter=self.other, kind="financial")
        self.file("Sensitive.txt", kind="visa", sensitive=True)
        private = inspect_version(
            add_file(self.owner, SimpleUploadedFile("Private.txt", b"Private unrelated fixture."))
        )
        policy = self.policy(include_future_files=True, include_future_versions=True)
        key = self.agent(policy)
        result = self.request_files(key).json()
        self.assertEqual([f["id"] for f in result["files"]], [str(passport.pk)])
        own_export = self.client.get(
            f"/api/v1/files/{private.pk}/download/", HTTP_AUTHORIZATION=f"Bearer {self.owner_key}"
        )
        self.assertEqual(own_export.status_code, 200)
        self.assertEqual(b"".join(own_export.streaming_content), b"Private unrelated fixture.")
        self.assertEqual(
            self.client.get(
                f"/api/v1/files/{private.pk}/download/", HTTP_AUTHORIZATION=f"Bearer {self.lawyer_key}"
            ).status_code,
            404,
        )
        for path in [
            "/api/v1/state/",
            "/api/v1/chat/",
            "/api/v1/credentials/",
            "/api/v1/received/",
            f"/api/v1/files/{private.pk}/download/",
        ]:
            denied = self.client.get(path, HTTP_AUTHORIZATION=f"Bearer {key}")
            self.assertEqual(denied.status_code, 403)
            self.assertNotContains(denied, "Private.txt", status_code=403)
        denied = self.post("/api/v1/policies/", {"confirm": True}, key)
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(self.post("/api/v1/preferences/", {"sharing_paused": False}, key).status_code, 403)
        self.assertEqual(
            self.post(
                "/api/v1/case-requests/", {"operation_id": str(uuid.uuid4()), "policy_id": str(policy.pk)}
            ).status_code,
            403,
        )
        self.assertEqual(private.document.matter_id, None)
        before = Transfer.objects.count()
        self.assertEqual(self.request_files(key, types=[]).status_code, 403)
        wrong_subject = self.post(
            "/api/v1/chat/",
            {"operation_id": str(uuid.uuid4()), "message": "Request tax file for Immigration case"},
            self.lawyer_key,
        )
        self.assertEqual(wrong_subject.status_code, 200, wrong_subject.content)
        self.assertEqual(wrong_subject.json()["result"]["files"], [])
        self.assertEqual(Transfer.objects.count(), before)
        # A manually received file in the same recipient account is outside this agent credential.
        manual = create_transfer(self.owner, private, self.contact, str(uuid.uuid4()))
        item = InboxItem.objects.get(transfer=manual)
        self.assertEqual(
            self.client.get(
                f"/api/agents/v1/received/{item.pk}/download/", HTTP_AUTHORIZATION=f"Bearer {key}"
            ).status_code,
            404,
        )
        saved = CustomerToken.objects.get(token_hash=hashlib.sha256(key.encode()).hexdigest())
        self.assertNotEqual(saved.token_hash, key)
        self.assertEqual(saved.policy_id, policy.pk)
        revoked = self.post(f"/api/v1/policies/{policy.pk}/revoke/", {})
        self.assertEqual(revoked.status_code, 200, revoked.content)
        self.assertEqual(
            self.client.get(
                result["files"][0]["download_url"], HTTP_AUTHORIZATION=f"Bearer {key}"
            ).status_code,
            403,
        )

    def test_snapshot_and_explicit_future_scope_preserve_original_versions(self):
        original = self.file()
        snapshot = self.policy()
        key = self.agent(snapshot)
        newer = self.file("Passport-v2.txt", b"New synthetic version.", document=original.document)
        doc = Document.objects.get(pk=original.document_id)
        doc.current_version = newer
        doc.save(update_fields=["current_version"])
        future = self.file("Future.txt", kind="visa")
        sensitive = self.file("Sensitive-future.txt", kind="financial", sensitive=True)
        result = self.request_files(key).json()
        self.assertEqual([f["id"] for f in result["files"]], [str(original.pk)])
        broad = self.policy(include_future_files=True, include_future_versions=True, include_sensitive=True)
        broad_key = self.agent(broad)
        result = self.request_files(broad_key).json()
        self.assertCountEqual(
            [f["id"] for f in result["files"]], [str(newer.pk), str(future.pk), str(sensitive.pk)]
        )
        create_transfer(self.owner, sensitive, self.contact, str(uuid.uuid4()))
        create_transfer(self.owner, sensitive, self.contact, str(uuid.uuid4()))
        # Moving an already-released document out of the case immediately removes future download authority.
        classify_document(self.owner, doc, matter_id=self.other.pk, document_type="passport")
        released = next(f for f in result["files"] if f["id"] == str(newer.pk))
        self.assertEqual(
            self.client.get(released["download_url"], HTTP_AUTHORIZATION=f"Bearer {broad_key}").status_code,
            403,
        )

    def test_pause_revoke_expiry_endpoint_and_mode_changes_stop_automatic_access(self):
        self.file()
        policy = self.policy()
        key = self.agent(policy)
        result = self.request_files(key).json()
        url = result["files"][0]["download_url"]
        self.owner.sharing_paused = True
        self.owner.save(update_fields=["sharing_paused"])
        self.assertEqual(self.client.get(url, HTTP_AUTHORIZATION=f"Bearer {key}").status_code, 403)
        self.owner.sharing_paused = False
        self.owner.save(update_fields=["sharing_paused"])
        StandingPolicy.objects.filter(pk=policy.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.request_files(key).status_code, 403)
        StandingPolicy.objects.filter(pk=policy.pk).update(expires_at=timezone.now() + timedelta(days=1))
        change_endpoint(self.owner, self.contact.pk, "replacement@example.test")
        self.assertEqual(self.client.get(url, HTTP_AUTHORIZATION=f"Bearer {key}").status_code, 403)
        self.owner.data_mode = "live"
        self.owner.save(update_fields=["data_mode"])
        self.assertEqual(
            self.client.get("/api/v1/state/", HTTP_AUTHORIZATION=f"Bearer {self.owner_key}").status_code, 401
        )

    def test_paginated_agent_requests_and_retries_charge_each_release_once(self):
        for i in range(11):
            self.file(f"File-{i}.txt")
        key = self.agent(self.policy())
        op = str(uuid.uuid4())
        first = self.post("/api/agents/v1/requests/", {"operation_id": op}, key)
        self.assertEqual(first.status_code, 200, first.content)
        page = first.json()
        self.assertEqual(len(page["files"]), 10)
        self.assertTrue(page["next_cursor"])
        retry = self.post("/api/agents/v1/requests/", {"operation_id": op}, key).json()
        self.assertEqual(retry["request_id"], page["request_id"])
        self.assertEqual(Transfer.objects.count(), 10)
        changed = self.post("/api/agents/v1/requests/", {"operation_id": op, "types": ["visa"]}, key)
        self.assertEqual(changed.status_code, 409)
        second = self.request_files(key, after=page["next_cursor"]).json()
        self.assertEqual(second["files"], [])
        self.assertEqual(second["outcomes"][0]["state"], "quota_exceeded")
        self.assertEqual(current_period(self.owner).consumed, 10)

    def test_chat_find_followup_send_and_relationship_labels_do_not_grant_authority(self):
        original = self.file()
        found = self.post("/api/v1/chat/", {"operation_id": str(uuid.uuid4()), "message": "Find my passport"})
        self.assertEqual(found.status_code, 200, found.content)
        self.assertEqual(found.json()["result"]["kind"], "search")
        operation = str(uuid.uuid4())
        sent = self.post("/api/v1/chat/", {"operation_id": operation, "message": "Send it to my lawyer"})
        self.assertEqual(sent.status_code, 200, sent.content)
        self.assertEqual(Transfer.objects.get().version_id, original.pk)
        self.assertEqual(Transfer.objects.get().status, "available_in_app")
        retry = self.post("/api/v1/chat/", {"operation_id": operation, "message": "Send it to my lawyer"})
        self.assertEqual(sent.json()["id"], retry.json()["id"])
        self.assertEqual(Transfer.objects.count(), 1)
        label = self.post(
            "/api/v1/chat/", {"operation_id": str(uuid.uuid4()), "message": "Alex is my lawyer"}
        )
        self.assertEqual(label.status_code, 200)
        draft = self.post(
            "/api/v1/chat/",
            {
                "operation_id": str(uuid.uuid4()),
                "message": "Let my lawyer request documents for my Immigration case",
            },
        ).json()
        self.assertEqual(draft["result"]["kind"], "policy_draft")
        self.assertEqual(StandingPolicy.objects.count(), 0)
        self.assertEqual(ChatExchange.objects.filter(owner=self.lawyer).count(), 0)

    def test_ambiguous_file_choice_cannot_turn_into_a_multi_file_release(self):
        self.file()
        second = self.file("Passport-copy.txt")
        pending = self.post(
            "/api/v1/chat/", {"operation_id": str(uuid.uuid4()), "message": "Send passport to my lawyer"}
        ).json()
        self.assertEqual(pending["result"]["kind"], "clarify")
        self.assertEqual(Transfer.objects.count(), 0)
        contact_only = self.post(
            "/api/v1/chat/",
            {
                "operation_id": str(uuid.uuid4()),
                "message": "Use Alex",
                "choice": {"turn_id": pending["id"], "contact_id": str(self.contact.pk)},
            },
        ).json()
        self.assertEqual(contact_only["result"]["kind"], "clarify")
        self.assertEqual(Transfer.objects.count(), 0)
        selected = self.post(
            "/api/v1/chat/",
            {
                "operation_id": str(uuid.uuid4()),
                "message": "Use Passport-copy",
                "choice": {"turn_id": contact_only["id"], "version_id": str(second.pk)},
            },
        )
        self.assertEqual(selected.status_code, 200, selected.content)
        self.assertEqual(Transfer.objects.get().version_id, second.pk)

    def test_web_setup_conversation_csrf_and_bearer_scope_share_the_same_services(self):
        self.file()
        browser = Client(enforce_csrf_checks=True)
        browser.force_login(self.owner)
        self.assertContains(browser.get(reverse("dashboard")), "Chat with")
        self.assertContains(browser.get(reverse("onboarding")), "Your files")
        self.assertEqual(
            browser.post(reverse("chat_message"), {"message": "Send passport to Alex"}).status_code, 403
        )
        # A session cookie is not a customer API credential.
        self.assertEqual(browser.get("/api/v1/state/").status_code, 401)
        before = StandingPolicy.objects.count()
        denied = self.post(
            "/api/v1/policies/",
            {
                "operation_id": str(uuid.uuid4()),
                "contact_id": str(self.contact.pk),
                "matter_id": str(self.matter.pk),
                "types": ["*"],
            },
        )
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(StandingPolicy.objects.count(), before)
        self.client.force_login(self.owner)
        self.assertContains(self.client.get(reverse("workspace")), "Native" if False else "Original files")
        # The recipient can revoke its token without granting any owner-side authority.
        key = self.agent(self.policy())
        token = CustomerToken.objects.get(token_hash=hashlib.sha256(key.encode()).hexdigest())
        self.post(f"/api/v1/credentials/{token.pk}/revoke/", {}, self.lawyer_key)
        self.assertEqual(self.request_files(key).status_code, 401)

    def test_chat_management_cards_and_search_keep_owner_authority(self):
        version = self.file(content=b"Synthetic indexed match: cedar tree.")
        before_grants = StandingPolicy.objects.count()
        for message, section in [
            ("Add files", "files"),
            ("Add a contact", "people"),
            ("Manage permissions", "permissions"),
            ("Change file details", "classify"),
        ]:
            response = self.post("/api/v1/chat/", {"message": message, "operation_id": str(uuid.uuid4())})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["result"]["section"], section)
            self.assertEqual(response.json()["result"]["kind"], "workspace_action")
        self.assertEqual(StandingPolicy.objects.count(), before_grants)
        self.assertEqual(Transfer.objects.count(), 0)
        result = self.client.get(
            "/api/v1/files/search/?q=cedar", HTTP_AUTHORIZATION=f"Bearer {self.owner_key}"
        )
        self.assertEqual([f["id"] for f in result.json()["files"]], [str(version.pk)])
        other = self.client.get(
            "/api/v1/files/search/?q=cedar", HTTP_AUTHORIZATION=f"Bearer {self.lawyer_key}"
        )
        self.assertEqual(other.json()["files"], [])
        _, agent_key = issue_token(self.lawyer, kind="agent", policy=self.policy())
        denied = self.client.get("/api/v1/files/search/?q=cedar", HTTP_AUTHORIZATION=f"Bearer {agent_key}")
        self.assertEqual(denied.status_code, 403)

    def test_chat_contact_and_case_edits_do_not_carry_authority_to_new_endpoints(self):
        self.file()
        permission = self.policy()
        _, key = issue_token(self.lawyer, kind="agent", policy=permission)
        response = self.post(
            f"/api/v1/contacts/{self.contact.pk}/update/",
            {"name": "Alex", "relationship": "Immigration lawyer", "aliases": "counsel"},
        )
        self.assertEqual(response.status_code, 200)
        self.contact.refresh_from_db()
        self.assertEqual(self.contact.endpoint_revision, permission.endpoint_revision)
        self.assertEqual(
            self.client.get("/api/agents/v1/permissions/", HTTP_AUTHORIZATION=f"Bearer {key}").status_code,
            200,
        )
        renamed = self.post(f"/api/v1/matters/{self.matter.pk}/rename/", {"name": "Work immigration"})
        self.assertEqual(renamed.status_code, 200)
        permission.refresh_from_db()
        self.assertEqual(permission.matter_id, self.matter.pk)
        self.assertEqual(StandingPolicy.objects.count(), 1)
        self.assertEqual(
            self.post(
                f"/api/v1/contacts/{self.contact.pk}/update/", {"name": "Wrong owner"}, key=self.lawyer_key
            ).status_code,
            404,
        )
        self.assertEqual(
            self.post(f"/api/v1/matters/{self.matter.pk}/rename/", {"name": "Denied"}, key=key).status_code,
            403,
        )
        changed = self.post(
            f"/api/v1/contacts/{self.contact.pk}/update/", {"email": "replacement@example.test"}
        )
        self.assertEqual(changed.status_code, 200)
        self.contact.refresh_from_db()
        self.assertGreater(self.contact.endpoint_revision, permission.endpoint_revision)
        self.assertIsNone(self.contact.verified_at)
        self.assertEqual(
            self.client.get("/api/agents/v1/permissions/", HTTP_AUTHORIZATION=f"Bearer {key}").status_code,
            403,
        )
        state = self.client.get("/api/v1/state/", HTTP_AUTHORIZATION=f"Bearer {self.owner_key}").json()
        self.assertTrue(state["policies"][0]["recipient_changed"])
        self.assertEqual(Transfer.objects.count(), 0)
