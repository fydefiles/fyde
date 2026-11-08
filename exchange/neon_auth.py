"""Managed Better Auth over its documented REST/session-verifier protocol.

The upstream cookie stays encrypted on the server. Fyde never stores a Neon
password and does not accept a client-supplied user ID or verification claim.
"""

import base64
import hashlib
import secrets
import uuid
from datetime import timedelta
from http.cookies import SimpleCookie
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.contrib.auth import login, logout
from django.db import IntegrityError, transaction
from django.http import HttpResponse, HttpResponseRedirect
from django.shortcuts import redirect
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import CustomerToken, NeonOAuthAttempt, NeonSession, User
from .policy import PolicyError, audit

COOKIE_NAME = "__Secure-neon-auth.session_token"
CHALLENGES = ("__Secure-neon-auth.session_challenge", "__Secure-neon-auth.session_challange")


def enabled():
    return settings.AUTH_PROVIDER == "neon"


def cipher():
    key = hashlib.sha256(("fyde/neon-session/v1:" + settings.SECRET_KEY).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(value):
    return cipher().encrypt(value.encode()).decode()


def decrypt(value):
    try:
        return cipher().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError):
        raise PolicyError("authentication_required", "Sign in again to continue.") from None


def call(path, *, data=None, cookie="", params=None):
    if not enabled():
        raise PolicyError("auth_unavailable", "Managed sign-in is not configured.")
    try:
        response = httpx.request(
            "POST" if data is not None else "GET",
            f"{settings.NEON_AUTH_BASE_URL}/{path}",
            json=data,
            params=params,
            headers={
                "Origin": settings.SITE_URL,
                "Cookie": cookie,
                "x-neon-auth-middleware": "true",
            },
            timeout=15,
            follow_redirects=False,
        )
    except httpx.HTTPError:
        raise PolicyError("auth_unavailable", "Sign-in is temporarily unavailable. Please retry.") from None
    if response.status_code >= 500:
        raise PolicyError("auth_unavailable", "Sign-in is temporarily unavailable. Please retry.")
    if response.status_code == 429:
        raise PolicyError("rate_limited", "Too many sign-in attempts. Try again shortly.")
    try:
        payload = response.json()
    except ValueError:
        raise PolicyError(
            "auth_unavailable", "Sign-in returned an unreadable response. Please retry."
        ) from None
    if not response.is_success:
        code = payload.get("code", "") if isinstance(payload, dict) else ""
        if code in ("EMAIL_NOT_VERIFIED", "EMAIL_VERIFICATION_REQUIRED"):
            raise PolicyError(
                "email_verification_required", "Enter the verification code sent to your email."
            )
        if code in ("INVALID_CALLBACKURL", "INVALID_ORIGIN", "INVALID_REDIRECT_URL"):
            raise PolicyError("auth_unavailable", "Sign-in is temporarily unavailable. Please retry.")
        # Do not expose tokens, provider internals, or account-existence details.
        raise PolicyError("authentication_required", "Check your sign-in details or verification code.")
    return response, payload


def cookies_from(response, names):
    result = {}
    for header in response.headers.get_list("set-cookie"):
        parsed = SimpleCookie()
        parsed.load(header.split(";", 1)[0])
        for name in names:
            if name in parsed and parsed[name].value:
                result[name] = parsed[name].value
    return "; ".join(f"{name}={value}" for name, value in result.items())


@transaction.atomic
def map_identity(identity):
    subject = str(identity.get("id", ""))
    email = str(identity.get("email", "")).strip().lower()
    if not subject or len(subject) > 128 or not email or len(email) > 254:
        raise PolicyError("authentication_required", "The sign-in identity is incomplete.")
    if identity.get("emailVerified") is not True or identity.get("banned"):
        raise PolicyError("email_verification_required", "Verify your email before signing in to Fyde.")
    user = User.objects.select_for_update().filter(neon_subject=subject).first()
    if user:
        if not user.is_active or user.email.lower() != email or user.data_mode != "live":
            raise PolicyError(
                "authentication_required", "This identity needs account support before signing in."
            )
        if not user.email_verified:
            user.email_verified = True
            user.save(update_fields=["email_verified"])
        return user
    existing = User.objects.select_for_update().filter(email__iexact=email).first()
    if existing:
        if (
            existing.neon_subject
            or not existing.email_verified
            or existing.data_mode != "live"
            or not existing.is_active
        ):
            raise PolicyError(
                "account_link_required",
                "This email already belongs to an account that needs verified linking.",
            )
        user = existing
    else:
        user = User(username=uuid.uuid4().hex, email=email, data_mode="live")
    user.neon_subject = subject
    user.email_verified = True
    user.first_name = str(identity.get("name", user.first_name))[:80]
    user.set_unusable_password()
    try:
        user.save()
    except IntegrityError:
        raise PolicyError(
            "authentication_required", "Retry sign-in to finish linking your account."
        ) from None
    audit(user, "identity.neon_linked", decision="verified_email_and_subject")
    return user


def session_from_response(response):
    cookie = cookies_from(response, (COOKIE_NAME,))
    if not cookie:
        raise PolicyError("authentication_required", "Sign in again after verifying your email.")
    _, payload = call("get-session", cookie=cookie, params={"disableCookieCache": "true"})
    if not isinstance(payload, dict) or not payload.get("session") or not payload.get("user"):
        raise PolicyError("authentication_required", "The sign-in session is unavailable.")
    user = map_identity(payload["user"])
    upstream = payload["session"]
    expires = parse_datetime(str(upstream.get("expiresAt", "")))
    if not expires or timezone.is_naive(expires) or expires <= timezone.now():
        raise PolicyError("authentication_required", "The sign-in session expired. Please sign in again.")
    return NeonSession.objects.create(
        owner=user,
        upstream_cookie=encrypt(cookie),
        upstream_id=str(upstream["id"]),
        expires_at=expires,
    )


def sign_in(email, password):
    response, _ = call("sign-in/email", data={"email": email, "password": password})
    return session_from_response(response)


def sign_up(name, email, password):
    response, _ = call("sign-up/email", data={"name": name, "email": email, "password": password})
    # A verified session is the only way into the app, even if the upstream
    # configuration accidentally allows unverified password sign-in.
    if cookies_from(response, (COOKIE_NAME,)):
        try:
            return session_from_response(response)
        except PolicyError as error:
            if error.code != "email_verification_required":
                raise
    return None


def verify_email(email, otp):
    response, _ = call("email-otp/verify-email", data={"email": email, "otp": otp})
    return session_from_response(response) if cookies_from(response, (COOKIE_NAME,)) else None


def send_code(email, *, purpose="email-verification"):
    call("email-otp/send-verification-otp", data={"email": email, "type": purpose})


def validate_session(session):
    if (
        session.revoked_at
        or session.expires_at <= timezone.now()
        or not session.owner.is_active
        or session.owner.data_mode != "live"
    ):
        raise PolicyError("authentication_required", "Your session expired. Sign in again.")
    _, payload = call(
        "get-session", cookie=decrypt(session.upstream_cookie), params={"disableCookieCache": "true"}
    )
    valid = isinstance(payload, dict) and payload.get("session") and payload.get("user")
    identity = payload.get("user", {}) if valid else {}
    remote_session = payload.get("session", {}) if valid else {}
    if (
        not valid
        or str(remote_session.get("id")) != session.upstream_id
        or str(identity.get("id")) != session.owner.neon_subject
        or str(identity.get("email", "")).lower() != session.owner.email.lower()
        or identity.get("emailVerified") is not True
        or identity.get("banned")
    ):
        revoke_local(session)
        raise PolicyError("authentication_required", "Your session expired or was revoked. Sign in again.")
    return session.owner


def revoke_local(session):
    session.revoked_at = timezone.now()
    session.save(update_fields=["revoked_at"])
    CustomerToken.objects.filter(neon_session=session, revoked_at=None).update(revoked_at=timezone.now())


def sign_out(session):
    revoke_local(session)
    try:
        call("sign-out", data={}, cookie=decrypt(session.upstream_cookie))
    except PolicyError:
        # Local release authority is already revoked. Do not resurrect it on a provider outage.
        return False
    return True


def browser_login(request, session):
    login(request, session.owner, backend="exchange.auth.EmailBackend")
    request.session["neon_session_id"] = str(session.pk)
    request.session.set_expiry(session.expires_at)


def browser_session(request):
    return (
        NeonSession.objects.select_related("owner")
        .filter(pk=request.session.get("neon_session_id"), owner=request.user)
        .first()
    )


def require_recent_confirmation(request):
    if not enabled():
        return request.user.check_password(request.POST.get("password", ""))
    session = browser_session(request)
    return bool(
        session
        and session.created_at > timezone.now() - timedelta(minutes=5)
        and secrets.compare_digest(request.POST.get("confirm_email", "").lower(), request.user.email.lower())
    )


class SessionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "POST" and request.path == "/logout/":
            # Clearing the caller's own local authority must also work during an Auth outage.
            return self.get_response(request)
        if request.user.is_authenticated:
            try:
                session = browser_session(request)
                if not session:
                    raise PolicyError("authentication_required", "Sign in again.")
                validate_session(session)
            except PolicyError as error:
                if error.code == "auth_unavailable":
                    return HttpResponse("Sign-in is temporarily unavailable. Please retry.", status=503)
                logout(request)
                return redirect("login")
        return self.get_response(request)


def google_start(request, *, attempt=None):
    state = secrets.token_urlsafe(32)
    callback = settings.SITE_URL + "/auth/google/callback/?" + urlencode({"state": state})
    response, payload = call(
        "sign-in/social", data={"provider": "google", "callbackURL": callback, "disableRedirect": True}
    )
    challenge = cookies_from(response, CHALLENGES)
    url = payload.get("url", "") if isinstance(payload, dict) else ""
    if not challenge or urlsplit(url).scheme != "https":
        raise PolicyError("auth_unavailable", "Google sign-in could not start. Please retry.")
    request.session["neon_oauth"] = {
        "state": state,
        "challenge": encrypt(challenge),
        "attempt": str(attempt.pk) if attempt else "",
        "expires": (timezone.now() + timedelta(minutes=5)).timestamp(),
    }
    return HttpResponseRedirect(url)


def google_finish(request):
    pending = request.session.pop("neon_oauth", {})
    verifier = request.GET.get("neon_auth_session_verifier", "")
    if (
        not pending.get("state")
        or pending.get("expires", 0) <= timezone.now().timestamp()
        or not secrets.compare_digest(pending["state"], request.GET.get("state", ""))
        or not verifier
        or len(verifier) > 4096
    ):
        raise PolicyError("authentication_required", "Google sign-in expired. Start again from Fyde.")
    response, _ = call(
        "get-session",
        cookie=decrypt(pending["challenge"]),
        params={"neon_auth_session_verifier": verifier},
    )
    session = session_from_response(response)
    if pending.get("attempt"):
        with transaction.atomic():
            attempt = NeonOAuthAttempt.objects.select_for_update().get(pk=pending["attempt"])
            if attempt.expires_at <= timezone.now() or attempt.consumed_at or attempt.session_id:
                sign_out(session)
                raise PolicyError(
                    "authentication_required", "Mobile sign-in expired. Start again in the app."
                )
            code = secrets.token_urlsafe(40)
            attempt.code_hash = hashlib.sha256(code.encode()).hexdigest()
            attempt.session = session
            attempt.save(update_fields=["code_hash", "session"])
        response = HttpResponse(status=302)
        response["Location"] = attempt.redirect_uri + "?" + urlencode({"code": code, "attempt": attempt.pk})
        response["Cache-Control"] = "no-store"
        response["Referrer-Policy"] = "no-referrer"
        return response
    browser_login(request, session)
    return redirect("dashboard" if session.owner.onboarding_completed_at else "onboarding")
