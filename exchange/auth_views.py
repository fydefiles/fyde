from django import forms
from django.conf import settings
from django.contrib import messages
from django.contrib.auth import logout
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.views import LogoutView
from django.shortcuts import redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_POST

from . import neon_auth, views
from .identity import rate_limit
from .models import NeonOAuthAttempt, User
from .policy import PolicyError


class SignInForm(forms.Form):
    username = forms.EmailField(label="Email address")
    password = forms.CharField(widget=forms.PasswordInput)


class SignupForm(forms.Form):
    first_name = forms.CharField(max_length=80, label="Your name")
    email = forms.EmailField()
    password1 = forms.CharField(widget=forms.PasswordInput, label="Password")
    password2 = forms.CharField(widget=forms.PasswordInput, label="Confirm password")

    def clean(self):
        result = super().clean()
        if result.get("password1") != result.get("password2"):
            self.add_error("password2", "The passwords do not match.")
        if result.get("password1"):
            validate_password(result["password1"], User(email=result.get("email", "")))
        return result


def limit(request, kind, count=15):
    rate_limit(f"neon-{kind}:{request.META.get('REMOTE_ADDR', '')}", count, 900)


def sign_in(request):
    if not neon_auth.enabled():
        return views.EmailLogin.as_view()(request)
    form = SignInForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        email = form.cleaned_data["username"].lower()
        try:
            limit(request, "login")
            session = neon_auth.sign_in(email, form.cleaned_data["password"])
            neon_auth.browser_login(request, session)
            destination = request.POST.get("next", "")
            if destination and url_has_allowed_host_and_scheme(
                destination, {request.get_host()}, require_https=not settings.DEBUG
            ):
                return redirect(destination)
            return redirect("dashboard" if session.owner.onboarding_completed_at else "onboarding")
        except PolicyError as error:
            if error.code == "email_verification_required":
                request.session["neon_pending_email"] = email
                try:
                    neon_auth.send_code(email)
                    return redirect("neon_verify_email")
                except PolicyError as verification_error:
                    form.add_error(None, str(verification_error))
                    return render(request, "registration/login.html", {"form": form})
            form.add_error(None, str(error))
    return render(
        request,
        "registration/login.html",
        {
            "form": form,
            "next": request.GET.get("next", ""),
            "neon_auth": True,
        },
    )


def sign_up(request):
    if not neon_auth.enabled():
        return views.signup(request)
    form = SignupForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            limit(request, "signup", 5)
            email = form.cleaned_data["email"].lower()
            session = neon_auth.sign_up(
                form.cleaned_data["first_name"], email, form.cleaned_data["password1"]
            )
            if session:
                neon_auth.browser_login(request, session)
                return redirect("onboarding")
            request.session["neon_pending_email"] = email
            return redirect("neon_verify_email")
        except PolicyError as error:
            form.add_error(None, str(error))
    return render(request, "registration/signup.html", {"form": form, "neon_auth": True})


def verify_email(request):
    if not neon_auth.enabled():
        return redirect("login")
    email = request.session.get("neon_pending_email")
    if not email:
        return redirect("login")
    error = ""
    if request.method == "POST":
        try:
            limit(request, "verify", 10)
            if request.POST.get("action") == "resend":
                neon_auth.send_code(email)
                messages.success(request, "A new verification code is on its way.")
            else:
                session = neon_auth.verify_email(email, request.POST.get("code", "")[:12])
                request.session.pop("neon_pending_email", None)
                if session:
                    neon_auth.browser_login(request, session)
                    return redirect("dashboard" if session.owner.onboarding_completed_at else "onboarding")
                messages.success(request, "Email verified. Sign in to open your workspace.")
                return redirect("login")
        except PolicyError as exc:
            error = str(exc)
    return render(request, "registration/neon_verify.html", {"email": email, "error": error})


def password_reset(request):
    if not neon_auth.enabled():
        return redirect("login")
    error = ""
    email = request.session.get("neon_reset_email", "")
    if request.method == "POST":
        try:
            limit(request, "reset", 5)
            if not email or request.POST.get("action") == "restart":
                email = forms.EmailField().clean(request.POST.get("email", "")).lower()
                neon_auth.send_code(email, purpose="forget-password")
                request.session["neon_reset_email"] = email
            else:
                password = request.POST.get("password", "")
                validate_password(password, User(email=email))
                neon_auth.call(
                    "email-otp/reset-password",
                    data={
                        "email": email,
                        "otp": request.POST.get("code", "")[:12],
                        "password": password,
                    },
                )
                from django.utils import timezone
                from .models import CustomerToken, NeonSession

                NeonSession.objects.filter(owner__email__iexact=email).update(revoked_at=timezone.now())
                CustomerToken.objects.filter(owner__email__iexact=email, kind="device").update(
                    revoked_at=timezone.now()
                )
                request.session.pop("neon_reset_email", None)
                messages.success(request, "Password updated. Sign in with your new password.")
                return redirect("login")
        except PolicyError as exc:
            error = str(exc)
        except forms.ValidationError as exc:
            error = " ".join(exc.messages)
    return render(request, "registration/neon_reset.html", {"email": email, "error": error})


@require_POST
def sign_out(request):
    if not neon_auth.enabled():
        return LogoutView.as_view()(request)
    session = neon_auth.browser_session(request) if request.user.is_authenticated else None
    if session:
        neon_auth.sign_out(session)
    logout(request)
    return redirect("login")


def google_start(request):
    if not neon_auth.enabled():
        return redirect("login")
    try:
        limit(request, "google")
        attempt = None
        ticket = request.GET.get("ticket")
        if ticket:
            from django.core import signing
            from django.utils import timezone

            try:
                attempt_id = signing.loads(ticket, salt="neon-mobile-oauth", max_age=300)
                attempt = NeonOAuthAttempt.objects.get(
                    pk=attempt_id, expires_at__gt=timezone.now(), consumed_at=None, session=None
                )
            except (signing.BadSignature, NeonOAuthAttempt.DoesNotExist, ValueError):
                raise PolicyError(
                    "authentication_required", "Start Google sign-in again from the Fyde app."
                ) from None
        return neon_auth.google_start(request, attempt=attempt)
    except PolicyError as error:
        return render(
            request,
            "exchange/message.html",
            {
                "heading": "Google sign-in needs another try",
                "message": str(error),
            },
            status=503 if error.code == "auth_unavailable" else 400,
        )


def google_callback(request):
    try:
        return neon_auth.google_finish(request)
    except PolicyError as error:
        return render(
            request,
            "exchange/message.html",
            {
                "heading": "Sign-in could not finish",
                "message": str(error),
            },
            status=400,
        )
