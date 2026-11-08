import re
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import F, Sum
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from .commands import resolve_command
from .delivery import readiness
from .forms import ContactForm, SignupForm, UploadForm
from .identity import consume_challenge, issue_challenge, rate_limit
from .models import (
    DELIVERY_CHANNELS,
    Challenge,
    InboxItem,
    Contact,
    Document,
    FileVersion,
    Grant,
    Mail,
    Notification,
    ProductMetric,
    Transfer,
    UsagePeriod,
)
from .policy import PolicyError, audit, check_transfer, current_period, entitlement, plans
from .storage import add_file
from . import blobstore
from .transfers import change_phone, change_endpoint, create_transfer, fulfill_request, revoke_transfer


def landing(request):
    campaign = request.GET.get("utm_campaign", "")
    if re.fullmatch(r"sharing-\d{8}", campaign):
        request.session["campaign"] = {
            "id": campaign,
            "expires": (timezone.now() + timedelta(hours=24)).timestamp(),
        }
        ProductMetric.objects.create(
            kind="landing",
            campaign=campaign,
            data_mode="fixture" if settings.EMAIL_ADAPTER == "local" else "live",
        )
    if request.user.is_authenticated:
        return redirect("dashboard")
    return render(request, "exchange/landing.html", {"plans": plans()["plans"]})


class EmailLogin(LoginView):
    template_name = "registration/login.html"

    def post(self, request, *args, **kwargs):
        try:
            rate_limit(f"login:{request.META.get('REMOTE_ADDR', '')}", 15, 900)
        except PolicyError as error:
            return render(
                request,
                "exchange/message.html",
                {"heading": "Try again shortly", "message": str(error)},
                status=429,
            )
        return super().post(request, *args, **kwargs)


def signup(request):
    form = SignupForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            rate_limit(f"signup:{request.META.get('REMOTE_ADDR', '')}", 5, 3600)
            with transaction.atomic():
                user = form.save(commit=False)
                user.username = uuid.uuid4().hex
                user.data_mode = "fixture" if settings.EMAIL_ADAPTER == "local" else "live"
                user.save()
                issue_challenge(user, "owner")
            login(request, user)
            campaign = request.session.get("campaign", {})
            if campaign.get("expires", 0) > timezone.now().timestamp():
                ProductMetric.objects.create(
                    owner=user, kind="signup", campaign=campaign["id"], data_mode=user.data_mode
                )
            messages.success(request, "Your account is ready. Verify your email before sending a file.")
            return redirect("onboarding")
        except (IntegrityError, PolicyError) as error:
            form.add_error(
                None, str(error) if isinstance(error, PolicyError) else "This account could not be created."
            )
    return render(request, "registration/signup.html", {"form": form})


def dashboard_context(request, **extra):
    owner = request.user
    key, plan, subscription = entitlement(owner)
    documents = (
        Document.objects.filter(owner=owner, deleted_at=None)
        .select_related("current_version")
        .order_by("-created_at")
    )
    contacts = Contact.objects.filter(owner=owner).order_by("name")
    context = {
        "documents": documents,
        "contacts": contacts,
        "transfers": Transfer.objects.filter(owner=owner)
        .select_related("version__document", "contact")
        .order_by("-created_at")[:30],
        "period": current_period(owner),
        "plan": plan,
        "plan_key": key,
        "subscription": subscription,
        "delivery": readiness(),
        "phone_delivery": readiness("phone"),
        "delivery_channels": DELIVERY_CHANNELS,
        "selected_channel": owner.default_delivery_channel,
        "operation_id": uuid.uuid4(),
        "notifications": Notification.objects.filter(owner=owner).order_by("-created_at")[:10],
        "grants": Grant.objects.filter(owner=owner)
        .select_related("contact", "version__document")
        .order_by("-created_at")[:30],
        "upload_form": UploadForm(owner),
        "contact_form": ContactForm(),
        "storage_bytes": FileVersion.objects.filter(
            document__owner=owner, document__deleted_at=None
        ).aggregate(n=Sum("size"))["n"]
        or 0,
    }
    context.update(extra)
    return context


@login_required
def dashboard(request):
    return render(request, "exchange/dashboard.html", dashboard_context(request))


@login_required
@require_POST
def upload(request):
    form = UploadForm(request.user, request.POST, request.FILES)
    if form.is_valid():
        try:
            add_file(
                request.user,
                form.cleaned_data["file"],
                title=form.cleaned_data["title"],
                tags=form.cleaned_data["tags"],
                sensitive=form.cleaned_data["sensitive"],
                document_id=form.cleaned_data["document"].pk if form.cleaned_data["document"] else None,
            )
            messages.success(request, "File uploaded privately. Safety checks are queued.")
            return redirect("dashboard")
        except PolicyError as error:
            form.add_error(None, str(error))
    return render(
        request,
        "exchange/dashboard.html",
        dashboard_context(request, upload_form=form, active_panel="files"),
        status=400,
    )


@login_required
@require_POST
def add_contact(request):
    form = ContactForm(request.POST)
    if form.is_valid():
        try:
            with transaction.atomic():
                contact = form.save(commit=False)
                contact.owner = request.user
                contact.save()
                from .recipients import refresh_contact_identity

                refresh_contact_identity(contact, request.user.data_mode)
            messages.success(
                request,
                "Contact added. Verified Fyde accounts can receive files in the app. Other endpoints need verification before sending.",
            )
            return redirect("dashboard")
        except (IntegrityError, PolicyError) as error:
            form.add_error(
                None,
                str(error)
                if isinstance(error, PolicyError)
                else "This email or phone is already in your contacts.",
            )
    return render(
        request,
        "exchange/dashboard.html",
        dashboard_context(request, contact_form=form, active_panel="contacts"),
        status=400,
    )


@login_required
@require_POST
def contact_action(request, contact_id):
    contact = get_object_or_404(Contact, pk=contact_id, owner=request.user)
    try:
        action = request.POST.get("action")
        if action == "verify":
            issue_challenge(
                request.user, "contact", contact=contact, channel=request.POST.get("channel", "email")
            )
            messages.success(request, "Verification message queued for the selected endpoint.")
        elif action == "pause":
            contact.paused = not contact.paused
            contact.save(update_fields=["paused"])
            audit(
                request.user, "contact.pause_changed", contact.pk, "paused" if contact.paused else "resumed"
            )
        elif action == "phone":
            change_phone(request.user, contact.pk, request.POST.get("phone", ""))
            messages.success(
                request,
                "Phone changed. Previous permissions are revoked; verify the new number before sending.",
            )
        elif action == "email":
            from django.core.validators import validate_email

            email = request.POST.get("email", "").lower()
            validate_email(email)
            contact = change_endpoint(request.user, contact.pk, email)
            issue_challenge(request.user, "contact", contact=contact)
            messages.success(
                request, "Address changed. Previous permissions are revoked; verification is required again."
            )
    except (PolicyError, ValidationError, IntegrityError) as error:
        messages.error(
            request,
            str(error)
            if isinstance(error, PolicyError)
            else "Enter an available, valid email address or phone number.",
        )
    return redirect("dashboard")


@login_required
@require_POST
def command(request):
    text = request.POST.get("command", "")
    context = request.session.get("conversation_context", {})
    if context.get("expires", 0) < timezone.now().timestamp():
        context = {}
    selected_channel = request.POST.get("channel") or request.user.default_delivery_channel
    try:
        rate_limit(f"command:{request.user.pk}", 60, 60)
        explicit = request.POST.get("version_id") and request.POST.get("contact_id")
        if explicit:
            result = {
                "action": "send",
                "version": get_object_or_404(
                    FileVersion,
                    pk=request.POST["version_id"],
                    document__owner=request.user,
                    document__deleted_at=None,
                ),
                "contact": get_object_or_404(Contact, pk=request.POST["contact_id"], owner=request.user),
            }
        else:
            result = resolve_command(request.user, text, context)
        if result["action"] == "send":
            operation = str(uuid.UUID(request.POST.get("operation_id", "")))
            selected_channel = (
                result.get("channel") or request.POST.get("channel") or request.user.default_delivery_channel
            )
            transfer = create_transfer(
                request.user, result["version"], result["contact"], operation, channel=selected_channel
            )
            if request.POST.get("remember_context") == "on":
                request.session["conversation_context"] = {
                    "version_id": str(transfer.version_id),
                    "contact_id": str(transfer.contact_id),
                    "source": "explicit_app_command",
                    "consent": True,
                    "captured_at": timezone.now().isoformat(),
                    "expires": (timezone.now() + timedelta(minutes=15)).timestamp(),
                }
            messages.success(
                request,
                "File available in the recipient’s Fyde inbox."
                if transfer.status == "available_in_app"
                else "Download link queued. Follow its status on the receipt.",
            )
            return redirect("receipt", transfer_id=transfer.pk)
        return render(
            request,
            "exchange/dashboard.html",
            dashboard_context(
                request,
                result=result,
                command_text=text,
                selected_channel=result.get("channel")
                or request.POST.get("channel")
                or request.user.default_delivery_channel,
            ),
        )
    except (PolicyError, ValueError, ValidationError) as error:
        return render(
            request,
            "exchange/dashboard.html",
            dashboard_context(
                request,
                command_text=text,
                selected_channel=selected_channel,
                command_error=str(error)
                if isinstance(error, PolicyError)
                else "Select a valid file, contact, and operation.",
            ),
            status=400,
        )


@login_required
def receipt(request, transfer_id):
    transfer = get_object_or_404(
        Transfer.objects.select_related("version__document", "contact", "grant"),
        pk=transfer_id,
        owner=request.user,
    )
    if request.method == "POST":
        revoke_transfer(request.user, transfer.pk)
        return redirect("receipt", transfer_id=transfer.pk)
    return render(
        request,
        "exchange/receipt.html",
        {
            "transfer": transfer,
            "inbox": InboxItem.objects.filter(transfer=transfer).first(),
            "notification": Mail.objects.filter(transfer=transfer).first(),
        },
    )


@login_required
def document(request, document_id):
    document = get_object_or_404(
        Document.objects.select_related("current_version"),
        pk=document_id,
        owner=request.user,
        deleted_at=None,
    )
    if request.method == "POST":
        if request.POST.get("action") == "current":
            version = get_object_or_404(
                FileVersion, pk=request.POST.get("version_id"), document=document, state="ready"
            )
            document.current_version = version
            document.save(update_fields=["current_version"])
            messages.success(
                request,
                "Preferred version updated. Existing permissions still cover their original versions.",
            )
        elif request.POST.get("action") == "delete":
            from .neon_auth import require_recent_confirmation

            if not require_recent_confirmation(request):
                messages.error(
                    request, "Confirm your identity to delete this document. If you use Neon, sign in within the last five minutes and enter your email."
                )
            else:
                with transaction.atomic():
                    Grant.objects.filter(version__document=document).update(
                        revoked_at=timezone.now(), revision=F("revision") + 1
                    )
                    for t in Transfer.objects.filter(version__document=document):
                        revoke_transfer(request.user, t.pk)
                    # Retain minimal metering/audit records, remove original bytes and searchable private text.
                    document.deleted_at = timezone.now()
                    document.title, document.tags = "Deleted document", ""
                    document.save(update_fields=["deleted_at", "title", "tags"])
                    document.versions.update(extracted_text="", original_name="Deleted file", state="deleted")
                    transaction.on_commit(blobstore.purge_deleted)
                messages.success(
                    request, "Sharing revoked and searchable text removed. File removal is queued for retry if needed."
                )
                return redirect("dashboard")
    return render(
        request,
        "exchange/document.html",
        {"document": document, "versions": document.versions.order_by("-number")},
    )


@login_required
def owner_download(request, version_id):
    version = get_object_or_404(
        FileVersion, pk=version_id, document__owner=request.user, document__deleted_at=None
    )
    # Export remains available after cancellation and does not consume send quota.
    return checked_file_response(version)


def checked_file_response(version):
    try:
        source = blobstore.open_verified(version)
    except PolicyError:
        raise Http404 from None
    response = FileResponse(
        source, as_attachment=True, filename=version.original_name, content_type="application/octet-stream"
    )
    response["Cache-Control"] = "no-store"
    response["Content-Security-Policy"] = "sandbox; default-src 'none'"
    return response


@login_required
@require_POST
def create_grant(request):
    try:
        version = get_object_or_404(
            FileVersion,
            pk=request.POST.get("version_id"),
            document__owner=request.user,
            document__deleted_at=None,
            state="ready",
        )
        contact = get_object_or_404(Contact, pk=request.POST.get("contact_id"), owner=request.user)
        days = int(request.POST.get("days", "7"))
        limit = int(request.POST.get("max_requests", "10"))
        sensitive = request.POST.get("sensitive_authorized") == "on"
        from .recipients import refresh_contact_identity, resolve_app_recipient

        refresh_contact_identity(contact, request.user.data_mode)
        channel = request.POST.get("channel") or request.user.default_delivery_channel
        if channel not in dict(DELIVERY_CHANNELS):
            raise PolicyError("unsupported_channel", "Choose Fyde, email, or phone delivery.")
        kind = "phone" if channel == "phone" else "email"
        if channel == "in_app":
            _, kind = resolve_app_recipient(contact, request.user.data_mode)
        verified = contact.phone_verified_at if kind == "phone" else contact.verified_at
        if not 1 <= days <= 90 or not 1 <= limit <= 1000 or not verified:
            raise PolicyError("invalid_grant", "Verify the contact and use 1–90 days and 1–1,000 requests.")
        if version.document.sensitive and not sensitive:
            raise PolicyError(
                "sensitive_consent", "Explicitly allow this sensitive file before creating a permission."
            )
        Grant.objects.create(
            owner=request.user,
            contact=contact,
            version=version,
            endpoint_revision=contact.endpoint_revision,
            kind="standing",
            channel=channel,
            identity_kind=kind,
            purpose=request.POST.get("purpose", "")[:150],
            expires_at=timezone.now() + timedelta(days=days),
            max_requests=limit,
            sensitive_authorized=sensitive,
        )
        messages.success(request, "Permission created for this exact version. Future versions are excluded.")
    except (PolicyError, ValueError, ValidationError) as error:
        messages.error(
            request, str(error) if isinstance(error, PolicyError) else "Choose valid permission values."
        )
    return redirect("dashboard")


@login_required
@require_POST
def revoke_grant(request, grant_id):
    with transaction.atomic():
        grant = get_object_or_404(Grant.objects.select_for_update(), pk=grant_id, owner=request.user)
        grant.revoked_at = timezone.now()
        grant.revision += 1
        grant.save(update_fields=["revoked_at", "revision"])
        for transfer in Transfer.objects.filter(grant=grant):
            revoke_transfer(request.user, transfer.pk)
    return redirect("dashboard")


@login_required
@require_POST
def settings_action(request):
    action = request.POST.get("action")
    if action == "pause":
        request.user.sharing_paused = not request.user.sharing_paused
        request.user.save(update_fields=["sharing_paused"])
        audit(
            request.user,
            "sharing.pause_changed",
            decision="paused" if request.user.sharing_paused else "resumed",
        )
    elif action == "clear_context":
        request.session.pop("conversation_context", None)
    elif action == "default_channel":
        channel = request.POST.get("channel")
        if channel in dict(DELIVERY_CHANNELS):
            request.user.default_delivery_channel = channel
            request.user.save(update_fields=["default_delivery_channel"])
            messages.success(request, "Default delivery updated. You can change it for each send.")
        else:
            messages.error(request, "Choose Fyde, email, or phone delivery.")
    elif action == "phone_identity":
        try:
            if not request.user.email_verified:
                raise PolicyError("owner_verification_required", "Verify your email before linking a phone.")
            from .recipients import phone_number

            phone = phone_number(request.POST.get("phone", ""))
            if not phone:
                raise PolicyError("endpoint_missing", "Enter a phone number with its country code.")
            issue_challenge(request.user, "phone_identity", channel="phone", destination=phone)
            messages.success(
                request,
                "Phone verification queued. Open the SMS link and enter its code to link this number.",
            )
        except PolicyError as error:
            messages.error(request, str(error))
    elif action == "verify":
        try:
            issue_challenge(request.user, "owner")
            messages.success(request, "Verification email queued.")
        except PolicyError as error:
            messages.error(request, str(error))
    return redirect("dashboard")


def verify(request, challenge_id, token):
    challenge = get_object_or_404(Challenge, pk=challenge_id)
    error = None
    if request.method == "POST":
        try:
            challenge = consume_challenge(challenge_id, token, request.POST.get("code", ""))
            if challenge.contact_id:
                request.session.cycle_key()
                request.session[f"recipient:{challenge.contact_id}"] = {
                    "revision": challenge.endpoint_revision,
                    "expires": (timezone.now() + timedelta(minutes=15)).timestamp(),
                    "scope": challenge.scope,
                    "channel": challenge.channel,
                    "data_mode": challenge.data_mode,
                    "transfer_id": str(challenge.transfer_id) if challenge.transfer_id else "",
                }
            if challenge.scope == "access":
                return redirect("access", transfer_id=challenge.transfer_id)
            if challenge.scope == "request":
                return redirect("incoming", contact_id=challenge.contact_id)
            return render(
                request,
                "exchange/message.html",
                {
                    "heading": "Phone verified" if challenge.channel == "phone" else "Email verified",
                    "message": "Your phone is linked to the receiving account. Return to Fyde to see received files."
                    if challenge.scope == "phone_identity"
                    else "This contact endpoint is verified. You can return to Fyde.",
                },
            )
        except PolicyError as failure:
            error = str(failure)
    return render(request, "exchange/verify.html", {"error": error}, status=400 if error else 200)


def verified_contact_kinds(request, contact):
    from .recipients import account_for

    kinds = []
    if request.user.is_authenticated:
        for kind in ("email", "phone"):
            user = account_for(contact, contact.owner.data_mode, kind)
            if user and user.pk == request.user.pk:
                kinds.append(kind)
    proof = request.session.get(f"recipient:{contact.pk}", {})
    if (
        proof.get("revision") == contact.endpoint_revision
        and proof.get("expires", 0) > timezone.now().timestamp()
        and proof.get("data_mode") == contact.owner.data_mode
        and proof.get("scope") == "request"
    ):
        kinds.append(proof.get("channel", "email"))
    return kinds


def recipient_verified(request, contact, transfer=None):
    if not transfer:
        return bool(verified_contact_kinds(request, contact))
    from .inbox import can_download

    if request.user.is_authenticated:
        try:
            can_download(request.user, transfer)
            return True
        except PolicyError:
            pass
    # Native delivery requires the specific verified recipient account.
    if transfer.channel == "in_app":
        return False
    proof = request.session.get(f"recipient:{contact.pk}", {})
    return (
        proof.get("revision") == contact.endpoint_revision
        and proof.get("expires", 0) > timezone.now().timestamp()
        and proof.get("data_mode") == transfer.data_mode
        and proof.get("channel") == transfer.grant.identity_kind
        and proof.get("scope") == "access"
        and proof.get("transfer_id") == str(transfer.pk)
    )


def transfer_download(request, transfer_id, *, inbox_only=False):
    with transaction.atomic():
        transfer = (
            Transfer.objects.select_for_update()
            .select_related("owner", "contact", "version__document", "grant")
            .get(pk=transfer_id)
        )
        if inbox_only:
            from .inbox import can_download

            can_download(request.user, transfer)
        elif not recipient_verified(request, transfer.contact, transfer):
            raise PolicyError("denied", "Verify the recipient before downloading.")
        check_transfer(transfer)
        if transfer.status not in (
            "provider_accepted",
            "delivered",
            "accessed",
            "test_available",
            "available_in_app",
        ):
            raise PolicyError("not_sent", "The transfer is not available for download.")
        _, plan, _ = entitlement(transfer.owner)
        period = current_period(transfer.owner, transfer.data_mode)
        maximum = plan["bandwidth_mib"] * 1024 * 1024
        updated = UsagePeriod.objects.filter(
            pk=period.pk, bandwidth_used__lte=maximum - transfer.version.size
        ).update(bandwidth_used=F("bandwidth_used") + transfer.version.size)
        if not updated:
            raise PolicyError(
                "bandwidth_limit", "This account has reached its separate download bandwidth limit."
            )
        response = checked_file_response(transfer.version)
        transfer.accessed_at, transfer.status = timezone.now(), "accessed"
        transfer.save(update_fields=["accessed_at", "status"])
        audit(transfer.owner, "transfer.accessed", transfer.pk, "verified_recipient_access")
        return response


def access(request, transfer_id):
    transfer = get_object_or_404(
        Transfer.objects.select_related("owner", "contact", "version__document", "grant"), pk=transfer_id
    )
    if request.user.is_authenticated:
        from .inbox import collect_received

        collect_received(request.user)
    if request.method == "POST" and request.POST.get("action") == "verify":
        try:
            check_transfer(transfer)
            if transfer.channel == "in_app":
                raise PolicyError(
                    "sign_in_required", "Sign in to the receiving Fyde account to download this file."
                )
            issue_challenge(transfer.owner, "access", contact=transfer.contact, transfer=transfer)
            return render(
                request,
                "exchange/message.html",
                {
                    "heading": "Check your phone" if transfer.channel == "phone" else "Check your email",
                    "message": "Open the verification link sent to the recipient and enter its code. The file will then be available to download in Fyde.",
                },
            )
        except PolicyError as error:
            return render(
                request,
                "exchange/message.html",
                {"heading": "Access unavailable", "message": str(error)},
                status=403,
            )
    if not recipient_verified(request, transfer.contact, transfer):
        return render(request, "exchange/access.html", {"verified": False, "channel": transfer.channel})
    try:
        check_transfer(transfer)
        if transfer.status not in (
            "provider_accepted",
            "delivered",
            "accessed",
            "test_available",
            "available_in_app",
        ):
            raise PolicyError("not_sent", "The transfer is not available for download.")
        if request.method == "POST" and request.POST.get("action") == "download":
            return transfer_download(request, transfer.pk)
        return render(request, "exchange/access.html", {"verified": True, "transfer": transfer})
    except PolicyError as error:
        return render(
            request,
            "exchange/message.html",
            {"heading": "Access unavailable", "message": str(error)},
            status=403,
        )


@login_required
def received(request):
    from .inbox import can_download, collect_received

    collect_received(request.user)
    items = (
        InboxItem.objects.filter(recipient=request.user)
        .select_related(
            "transfer__owner", "transfer__contact", "transfer__grant", "transfer__version__document"
        )
        .order_by("-created_at")[:100]
    )
    for item in items:
        try:
            can_download(request.user, item.transfer)
            item.available = True
        except PolicyError as error:
            item.available, item.reason = False, str(error)
    return render(request, "exchange/received.html", {"items": items})


@login_required
@require_POST
def received_download(request, item_id):
    item = get_object_or_404(InboxItem, pk=item_id, recipient=request.user)
    try:
        return transfer_download(request, item.transfer_id, inbox_only=True)
    except PolicyError as error:
        return render(
            request,
            "exchange/message.html",
            {"heading": "Access unavailable", "message": str(error)},
            status=403,
        )


def incoming(request, contact_id):
    contact = get_object_or_404(Contact.objects.select_related("owner"), pk=contact_id)
    if not recipient_verified(request, contact):
        if request.method == "POST":
            try:
                issue_challenge(
                    contact.owner,
                    "request",
                    contact=contact,
                    channel=request.POST.get("channel") or ("email" if contact.email else "phone"),
                )
                return render(
                    request,
                    "exchange/message.html",
                    {
                        "heading": "Check your email or phone",
                        "message": "Open the verification message sent to the contact endpoint. Private documents are shown only after verification.",
                    },
                )
            except PolicyError as error:
                messages.error(request, str(error))
        return render(
            request,
            "exchange/incoming.html",
            {"verified": False, "has_email": bool(contact.email), "has_phone": bool(contact.phone)},
        )
    grants = Grant.objects.filter(
        contact=contact,
        kind="standing",
        revoked_at=None,
        endpoint_revision=contact.endpoint_revision,
        identity_kind__in=verified_contact_kinds(request, contact),
        expires_at__gt=timezone.now(),
    ).select_related("version__document")
    result = None
    if request.method == "POST":
        try:
            operation = str(uuid.UUID(request.POST.get("operation_id", "")))
            result = fulfill_request(
                contact,
                request.POST.getlist("versions"),
                request.POST.get("purpose", ""),
                operation,
                identity_kinds=verified_contact_kinds(request, contact),
            )
        except (ValueError, PolicyError) as error:
            messages.error(
                request, str(error) if isinstance(error, PolicyError) else "The request is invalid."
            )
    return render(
        request,
        "exchange/incoming.html",
        {"verified": True, "grants": grants, "result": result, "operation_id": uuid.uuid4()},
    )


@login_required
def outbox(request):
    if not settings.DEBUG or (settings.EMAIL_ADAPTER != "local" and settings.SMS_ADAPTER != "local"):
        raise Http404
    return render(
        request,
        "exchange/outbox.html",
        {"mail": Mail.objects.filter(owner=request.user, data_mode="fixture").order_by("-created_at")[:50]},
    )


@login_required
def export_metadata(request):
    payload = {
        "email": request.user.email,
        "documents": list(
            Document.objects.filter(owner=request.user, deleted_at=None).values(
                "id", "title", "tags", "sensitive"
            )
        ),
        "contacts": list(
            Contact.objects.filter(owner=request.user).values("id", "name", "email", "phone", "aliases")
        ),
        "transfers": list(
            Transfer.objects.filter(owner=request.user).values(
                "id", "version_id", "contact_id", "status", "created_at", "data_mode", "channel"
            )
        ),
    }
    response = JsonResponse(payload, json_dumps_params={"indent": 2})
    response["Content-Disposition"] = 'attachment; filename="fyde-export.json"'
    return response


def health(request):
    from django.db import connections

    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT 1")
    return JsonResponse(
        {"status": "ok", "service": "fyde", "revision": __import__("os").environ.get("RELEASE_SHA", "local")}
    )


def pricing(request):
    return render(
        request,
        "exchange/pricing.html",
        {
            "plans": plans()["plans"],
            "billing_ready": bool(settings.STRIPE_API_KEY),
            "billing_mode": "live" if settings.STRIPE_LIVE_ENABLED else "sandbox",
        },
    )


def privacy(request):
    return render(request, "exchange/privacy.html")
