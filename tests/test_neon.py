"""Provider-bound journeys. Mocked transport here; live Neon evidence is recorded separately."""

import base64
import hashlib
import io
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import httpx
from botocore.exceptions import EndpointConnectionError
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from exchange import blobstore, neon_auth
from exchange.models import CustomerToken, FileVersion, NeonOAuthAttempt, NeonSession, User
from exchange.storage import add_file, inspect_version


@override_settings(AUTH_PROVIDER="neon", NEON_AUTH_BASE_URL="https://example.neonauth.neon.tech/neondb/auth")
class NeonIdentityJourney(TestCase):
    def setUp(self):
        self.subject = str(uuid.uuid4())
        self.identity = {
            "id": self.subject,
            "email": "verified@example.test",
            "emailVerified": True,
            "name": "Owner",
        }
        self.valid = True
        self.remote = patch("exchange.neon_auth.httpx.request", side_effect=self.provider).start()
        self.addCleanup(patch.stopall)

    def provider(self, method, url, **kwargs):
        cookie = {"set-cookie": f"{neon_auth.COOKIE_NAME}=provider-signed-session; Path=/; HttpOnly; Secure"}
        if url.endswith("sign-in/email"):
            return httpx.Response(200, json={"user": self.identity}, headers=cookie)
        if url.endswith("sign-up/email"):
            self.identity["emailVerified"] = False
            return httpx.Response(200, json={"user": self.identity}, headers=cookie)
        if url.endswith("sign-in/social"):
            return httpx.Response(
                200,
                json={"url": "https://accounts.google.com/oauth"},
                headers={
                    "set-cookie": f"{neon_auth.CHALLENGES[0]}=signed-challenge; Path=/; HttpOnly; Secure",
                },
            )
        if url.endswith("get-session"):
            if kwargs.get("params", {}).get("neon_auth_session_verifier"):
                return httpx.Response(200, json={}, headers=cookie)
            if not self.valid:
                return httpx.Response(200, content=b"null", headers={"content-type": "application/json"})
            return httpx.Response(
                200,
                json={
                    "session": {
                        "id": "provider-session-id",
                        "expiresAt": (timezone.now() + timedelta(hours=1)).isoformat(),
                    },
                    "user": self.identity,
                }
                if self.valid
                else None,
            )
        if url.endswith("sign-out"):
            self.valid = False
            return httpx.Response(200, json={"success": True})
        raise AssertionError("Unexpected provider endpoint")

    def login_api(self):
        return self.client.post(
            "/api/v1/login/",
            {"email": self.identity["email"], "password": "Not-stored-password-1!"},
            content_type="application/json",
        )

    def test_neon_login_binds_device_to_verified_subject_and_provider_revocation(self):
        result = self.login_api()
        self.assertEqual(result.status_code, 200)
        token = result.json()["token"]
        user = User.objects.get(neon_subject=self.subject)
        self.assertFalse(user.has_usable_password())
        connection = NeonSession.objects.get(owner=user)
        self.assertNotIn("provider-signed-session", connection.upstream_cookie)
        self.assertEqual(
            self.client.get("/api/v1/state/", HTTP_AUTHORIZATION="Bearer " + token).status_code,
            200,
        )
        self.valid = False
        self.assertEqual(
            self.client.get("/api/v1/state/", HTTP_AUTHORIZATION="Bearer " + token).status_code,
            401,
        )
        self.assertIsNotNone(CustomerToken.objects.get(neon_session=connection).revoked_at)
        self.valid = True
        fresh = self.login_api().json()["token"]
        self.remote.side_effect = httpx.ConnectError("synthetic outage")
        signed_out = self.client.post(
            "/api/v1/logout/", {}, content_type="application/json", HTTP_AUTHORIZATION="Bearer " + fresh
        )
        self.assertEqual(signed_out.status_code, 200)
        self.assertFalse(signed_out.json()["provider_signed_out"])
        self.remote.side_effect = self.provider
        self.assertEqual(
            self.client.get("/api/v1/state/", HTTP_AUTHORIZATION="Bearer " + fresh).status_code, 401
        )

    def test_signup_and_login_cannot_promote_an_unverified_identity_or_fixture_account(self):
        self.identity["emailVerified"] = False
        self.assertEqual(self.login_api().status_code, 403)
        self.assertFalse(User.objects.exists())
        self.identity["emailVerified"] = True
        User.objects.create_user(
            username="fixture", email=self.identity["email"], data_mode="fixture", email_verified=True
        )
        self.assertEqual(self.login_api().status_code, 403)
        self.assertFalse(User.objects.exclude(neon_subject=None).exists())

    def test_verified_account_linking_keeps_existing_file_ownership(self):
        owner = User.objects.create_user(
            username="existing", email=self.identity["email"], data_mode="live", email_verified=True
        )
        result = self.login_api()
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["user"]["id"], owner.pk)
        self.assertEqual(User.objects.count(), 1)
        owner.refresh_from_db()
        self.assertEqual(owner.neon_subject, self.subject)

    def test_google_callback_requires_browser_state_and_mobile_pkce_can_be_redeemed_once(self):
        verifier = "s" * 64
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        result = self.client.post(
            "/api/v1/auth/google/start/",
            {
                "code_challenge": challenge,
                "redirect_uri": "https://attacker.example/callback",
            },
            content_type="application/json",
        )
        self.assertEqual(result.status_code, 403)
        result = self.client.post(
            "/api/v1/auth/google/start/",
            {
                "code_challenge": challenge,
                "redirect_uri": "fyde://auth/callback",
            },
            content_type="application/json",
        ).json()
        self.assertEqual(self.client.get(result["url"]).status_code, 302)
        pending = self.client.session["neon_oauth"]
        alien = Client()
        self.assertEqual(
            alien.get(
                reverse("neon_google_callback"),
                {
                    "state": pending["state"],
                    "neon_auth_session_verifier": "verifier",
                },
            ).status_code,
            400,
        )
        self.assertFalse(NeonSession.objects.exists())
        callback = self.client.get(
            reverse("neon_google_callback"),
            {
                "state": pending["state"],
                "neon_auth_session_verifier": "verifier",
            },
        )
        self.assertEqual(callback.status_code, 302)
        params = parse_qs(urlsplit(callback["Location"]).query)
        data = {"attempt": result["attempt"], "code": params["code"][0], "code_verifier": "wrong" * 12}
        self.assertEqual(
            self.client.post(
                "/api/v1/auth/google/exchange/", data, content_type="application/json"
            ).status_code,
            401,
        )
        data["code_verifier"] = verifier
        self.assertEqual(
            self.client.post(
                "/api/v1/auth/google/exchange/", data, content_type="application/json"
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/auth/google/exchange/", data, content_type="application/json"
            ).status_code,
            401,
        )
        self.assertIsNotNone(NeonOAuthAttempt.objects.get(pk=result["attempt"]).consumed_at)

    def test_neon_web_session_closes_after_provider_revocation(self):
        middleware = list(settings.MIDDLEWARE)
        middleware.insert(
            middleware.index("django.contrib.auth.middleware.AuthenticationMiddleware") + 1,
            "exchange.neon_auth.SessionMiddleware",
        )
        with override_settings(MIDDLEWARE=middleware):
            browser = Client()
            result = browser.post(
                reverse("login"), {"username": self.identity["email"], "password": "Not-stored-password-1!"}
            )
            self.assertEqual(result.status_code, 302)
            self.assertIn("neon_session_id", browser.session)
            self.valid = False
            self.assertRedirects(browser.get(reverse("dashboard")), reverse("login"))


class MemoryS3:
    def __init__(self):
        self.objects = {}
        self.fail_deletion = False

    def put_object(self, **kwargs):
        self.objects[kwargs["Key"]] = kwargs["Body"].read()

    def get_object(self, **kwargs):
        raw = self.objects[kwargs["Key"]]
        return {"Body": io.BytesIO(raw), "ContentLength": len(raw)}

    def delete_object(self, **kwargs):
        if self.fail_deletion:
            raise EndpointConnectionError(endpoint_url="https://example.invalid")
        self.objects.pop(kwargs["Key"], None)


@override_settings(
    FILE_STORAGE="neon", AUTH_PROVIDER="local", NEON_STORAGE_BUCKET="uploads", SCAN_ADAPTER="text_only"
)
class NeonStorageJourney(TestCase):
    def setUp(self):
        self.store = MemoryS3()
        patcher = patch("exchange.blobstore.client", return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        override = override_settings(MEDIA_ROOT=Path(self.folder.name))
        override.enable()
        self.addCleanup(override.disable)
        self.owner = User.objects.create_user(
            username="owner",
            email="owner@example.test",
            password="Original-password-728!",
            data_mode="fixture",
            email_verified=True,
        )
        self.client.force_login(self.owner)

    def test_private_upload_index_download_integrity_and_durable_deletion(self):
        raw = b"Synthetic original bytes stored remotely."
        version = add_file(self.owner, SimpleUploadedFile("Resume.txt", raw))
        self.assertEqual(version.state, "quarantined")
        self.assertFalse(list(Path(self.folder.name).rglob("*")))
        inspect_version(version)
        self.assertEqual(version.state, "ready")
        download = self.client.get(reverse("owner_download", args=[version.pk]))
        self.assertEqual(b"".join(download.streaming_content), raw)
        self.store.objects[version.blob_key] = b"Tampered original"
        self.assertEqual(self.client.get(reverse("owner_download", args=[version.pk])).status_code, 404)
        self.store.objects[version.blob_key] = raw
        self.store.fail_deletion = True
        with self.captureOnCommitCallbacks(execute=True):
            result = self.client.post(
                reverse("document", args=[version.document_id]),
                {"action": "delete", "password": "Original-password-728!"},
            )
        self.assertEqual(result.status_code, 302)
        self.assertEqual(self.client.get(reverse("owner_download", args=[version.pk])).status_code, 404)
        self.assertIn(version.blob_key, self.store.objects)
        # A scanner already holding the original must not restore private text after deletion.
        inspect_version(version)
        version.refresh_from_db()
        self.assertEqual(version.state, "deleted")
        self.assertEqual(version.extracted_text, "")
        self.store.fail_deletion = False
        self.assertEqual(blobstore.purge_deleted(), 1)
        self.assertNotIn(version.blob_key, self.store.objects)
        self.assertIsNotNone(FileVersion.objects.get(pk=version.pk).blob_deleted_at)
