"""Customer-only APIs. Bearer credentials never authorize company controls or permission changes by agents."""

import json
from functools import wraps

from django.conf import settings
from django.contrib.auth import authenticate
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import Http404, HttpResponse, JsonResponse
from django.http.response import HttpResponseBase
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from . import chat, setup
from .customer_access import authenticate_token, issue_token
from .delegation import check_policy, create_policy, fulfill_case
from .identity import issue_challenge, rate_limit
from .inbox import can_download, collect_received
from .models import (
    DOCUMENT_TYPES,
    CaseRequest,
    Contact,
    CustomerToken,
    Document,
    InboxItem,
    Matter,
    StandingPolicy,
)
from .policy import PolicyError, audit, current_period, entitlement
from .recipients import refresh_contact_identity


def body(request):
    if request.content_type == "application/json":
        value = json.loads(request.body)
        if not isinstance(value, dict):
            raise PolicyError("invalid_request", "Send a JSON object.")
        return value
    return request.POST


def operation(data):
    import uuid

    try:
        return str(uuid.UUID(str(data.get("operation_id", ""))))
    except ValueError:
        raise PolicyError(
            "invalid_operation", "Supply a unique UUID operation_id and reuse it only for retries."
        ) from None


def api(methods=("GET",), kinds=("device",), public=False):
    def decorate(fn):
        @csrf_exempt
        @wraps(fn)
        def wrapped(request, *args, **kwargs):
            origin = request.headers.get("Origin", "")
            allowed = origin in settings.CUSTOMER_API_ORIGINS or origin == settings.SITE_URL
            if origin and not allowed:
                return JsonResponse(
                    {"error": "origin_denied", "message": "This web origin is not authorized."}, status=403
                )
            try:
                if request.method == "OPTIONS":
                    response = HttpResponse(status=204)
                elif request.method not in methods:
                    response = JsonResponse({"error": "method_not_allowed"}, status=405)
                else:
                    if not public:
                        request.customer_token = authenticate_token(
                            request.headers.get("Authorization", ""), kinds
                        )
                        request.user = request.customer_token.owner
                        rate_limit(f"customer-api:{request.customer_token.pk}", 180, 60)
                    result = fn(request, *args, **kwargs)
                    response = (
                        result
                        if isinstance(result, HttpResponseBase)
                        else JsonResponse(result, safe=isinstance(result, dict))
                    )
            except PolicyError as error:
                status = (
                    401
                    if error.code == "authentication_required"
                    else 429
                    if error.code == "rate_limited"
                    else 409
                    if error.code == "idempotency_conflict"
                    else 403
                )
                response = JsonResponse({"error": error.code, "message": str(error)}, status=status)
            except Http404:
                response = JsonResponse(
                    {"error": "unavailable", "message": "This item is unavailable."}, status=404
                )
            except (ValueError, ValidationError, TypeError, IntegrityError):
                response = JsonResponse(
                    {"error": "invalid_request", "message": "Check the supplied values and try again."},
                    status=400,
                )
            response["Cache-Control"] = "no-store"
            if origin and allowed:
                response["Access-Control-Allow-Origin"] = origin
                response["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
                response["Access-Control-Allow-Methods"] = ", ".join([*methods, "OPTIONS"])
                response["Vary"] = "Origin"
            return response

        return wrapped

    return decorate


def profile(user):
    return {
        "id": user.pk,
        "name": user.first_name,
        "email": user.email,
        "email_verified": user.email_verified,
        "data_mode": user.data_mode,
        "onboarding_complete": bool(user.onboarding_completed_at),
        "default_channel": user.default_delivery_channel,
        "sharing_paused": user.sharing_paused,
        "chat_context_enabled": user.chat_context_enabled,
    }


def policy_card(p):
    return {
        "id": str(p.pk),
        "data_mode": p.data_mode,
        "matter_id": str(p.matter_id),
        "case": p.matter.name,
        "contact_id": str(p.contact_id),
        "contact": p.contact.name,
        "owner": p.owner.first_name or "File owner",
        "types": p.document_types,
        "future_files": p.include_future_files,
        "future_versions": p.include_future_versions,
        "sensitive": p.include_sensitive,
        "expires_at": p.expires_at.isoformat(),
        "expiry_label": p.expires_at.strftime("%b %d, %Y %H:%M UTC"),
        "channel": p.channel,
        "used": p.requests_used,
        "limit": p.max_requests,
        "revoked": bool(p.revoked_at),
    }


def available_policies(user):
    result = []
    for p in chat.peer_policies(user):
        try:
            check_policy(p, requester=user)
            result.append(p)
        except PolicyError:
            pass
    return result


def workspace(user):
    _, plan, _ = entitlement(user)
    docs = (
        Document.objects.filter(owner=user, deleted_at=None)
        .select_related("current_version", "matter")
        .order_by("-created_at")
    )
    contacts = list(Contact.objects.filter(owner=user).order_by("name"))
    for contact in contacts:
        refresh_contact_identity(contact, user.data_mode)
    return {
        "user": profile(user),
        "files": [
            {
                **chat.file_card(d.current_version),
                "matter_id": str(d.matter_id) if d.matter_id else "",
                "sensitive": d.sensitive,
            }
            for d in docs
            if d.current_version_id
        ],
        "contacts": [
            {
                **chat.contact_card(c),
                "email": c.email,
                "phone": c.phone,
                "verified": bool(c.verified_at or c.phone_verified_at),
            }
            for c in contacts
        ],
        "matters": [{"id": str(m.pk), "name": m.name} for m in Matter.objects.filter(owner=user)],
        "document_types": [{"id": key, "name": label} for key, label in DOCUMENT_TYPES],
        "policies": [
            policy_card(p)
            for p in StandingPolicy.objects.filter(owner=user).select_related("owner", "matter", "contact")
        ],
        "received_permissions": [policy_card(p) for p in available_policies(user)],
        "plan": plan,
        "consumed": current_period(user).consumed,
    }


@api(("POST",), public=True)
def sign_in(request):
    data = body(request)
    rate_limit(f"mobile-login:{request.META.get('REMOTE_ADDR', '')}", 15, 900)
    email = str(data.get("email", ""))[:254]
    user = authenticate(request, username=email, password=str(data.get("password", "")))
    if not user:
        raise PolicyError("authentication_required", "The email or password is incorrect.")
    token, raw = issue_token(user, name=str(data.get("device_name", "Mobile device")))
    return {"token": raw, "expires_at": token.expires_at.isoformat(), "user": profile(user)}


@api(("POST",), public=True)
def sign_up(request):
    from .forms import SignupForm
    import uuid

    data = body(request)
    rate_limit(f"mobile-signup:{request.META.get('REMOTE_ADDR', '')}", 5, 3600)
    form = SignupForm(
        {
            "email": data.get("email"),
            "first_name": data.get("name"),
            "password1": data.get("password"),
            "password2": data.get("password"),
        }
    )
    if not form.is_valid():
        return JsonResponse(
            {
                "error": "invalid_signup",
                "message": " ".join(str(e) for errors in form.errors.values() for e in errors),
            },
            status=400,
        )
    with transaction.atomic():
        user = form.save(commit=False)
        user.username = uuid.uuid4().hex
        user.data_mode = "fixture" if settings.EMAIL_ADAPTER == "local" else "live"
        user.save()
        issue_challenge(user, "owner")
        token, raw = issue_token(user)
    return {"token": raw, "expires_at": token.expires_at.isoformat(), "user": profile(user)}


@api(("POST",))
def sign_out(request):
    token = request.customer_token
    token.revoked_at = timezone.now()
    token.save(update_fields=["revoked_at"])
    return {"signed_out": True}


@api()
def state(request):
    return workspace(request.user)


@api(("GET", "POST"))
def conversation(request):
    if request.method == "GET":
        return {"turns": chat.history(request.user)}
    data = body(request)
    rate_limit(f"customer-chat:{request.user.pk}", 60, 60)
    return chat.serialize(
        chat.converse(
            request.user,
            data.get("message", ""),
            operation(data),
            channel=data.get("channel"),
            choice=data.get("choice"),
        )
    )


@api(("POST",))
def preferences(request):
    data = body(request)
    if set(data) - {"default_channel", "chat_context_enabled", "sharing_paused"}:
        raise PolicyError("invalid_preferences", "Choose supported account preferences.")
    user = request.user
    fields = []
    if "default_channel" in data:
        if data["default_channel"] not in ("in_app", "email", "phone"):
            raise PolicyError("invalid_preferences", "Choose Fyde, email or phone.")
        user.default_delivery_channel = data["default_channel"]
        fields.append("default_delivery_channel")
    for field in ("chat_context_enabled", "sharing_paused"):
        if field in data:
            if not isinstance(data[field], bool):
                raise PolicyError("invalid_preferences", "Use an explicit on/off choice.")
            setattr(user, field, data[field])
            fields.append(field)
    if fields:
        user.save(update_fields=fields)
        audit(user, "customer.preferences_changed", decision="owner_updated", fields=fields)
    return {"user": profile(user)}


@api(("POST",))
def verify_email(request):
    issue_challenge(request.user, "owner")
    return {"message": "Verification email queued. Open its link, then refresh your account in the app."}


@api(("POST",))
def matters(request):
    item = setup.create_matter(request.user, str(body(request).get("name", "")))
    return {"id": str(item.pk), "name": item.name}


@api(("POST",))
def contacts(request):
    item = setup.add_contact(request.user, body(request))
    return chat.contact_card(item)


@api(("POST",))
def upload(request):
    if not request.FILES.get("file"):
        raise PolicyError("file_required", "Choose a file.")
    data = request.POST
    version = setup.upload_document(
        request.user,
        request.FILES["file"],
        matter_id=data.get("matter_id") or None,
        document_type=data.get("document_type", "general"),
        sensitive=data.get("sensitive") == "true",
    )
    return {"file": chat.file_card(version), "message": "Uploaded privately. Safety checks are queued."}


@api(("POST",))
def classify(request, document_id):
    data = body(request)
    doc = get_object_or_404(Document, pk=document_id, owner=request.user, deleted_at=None)
    setup.classify_document(
        request.user,
        doc,
        matter_id=data.get("matter_id"),
        document_type=data.get("document_type", "general"),
        sensitive=data.get("sensitive") is True,
    )
    return {"updated": True}


def policy_from_data(owner, data):
    if data.get("confirm") is not True:
        raise PolicyError(
            "owner_consent_required", "Review the case scope and explicitly enable automatic sharing."
        )
    return create_policy(
        owner,
        contact_id=data.get("contact_id"),
        matter_id=data.get("matter_id"),
        operation_id=operation(data),
        types=data.get("types", ["*"]),
        days=data.get("days", 90),
        max_requests=data.get("max_requests", 100),
        channel=data.get("channel", "in_app"),
        include_future_files=data.get("future_files") is True,
        include_future_versions=data.get("future_versions") is True,
        include_sensitive=data.get("sensitive") is True,
    )


@api(("POST",))
def policies(request):
    return {"policy": policy_card(policy_from_data(request.user, body(request)))}


@api(("POST",))
def revoke_case(request, policy_id):
    from .delegation import revoke_policy

    get_object_or_404(StandingPolicy, pk=policy_id, owner=request.user)
    revoke_policy(request.user, policy_id)
    return {"revoked": True}


@api(("POST",))
def finish_setup(request):
    setup.complete_setup(request.user)
    return {"user": profile(request.user)}


@api(("GET", "POST"))
def credentials(request):
    if request.method == "GET":
        return {
            "tokens": [
                {"id": str(t.pk), "name": t.name, "kind": t.kind, "expires_at": t.expires_at.isoformat()}
                for t in CustomerToken.objects.filter(owner=request.user, revoked_at=None)
            ]
        }
    data = body(request)
    policy = get_object_or_404(StandingPolicy, pk=data.get("policy_id"), recipient=request.user)
    token, raw = issue_token(
        request.user, kind="agent", name=str(data.get("name", "Case agent")), policy=policy
    )
    return {
        "token": raw,
        "id": str(token.pk),
        "expires_at": token.expires_at.isoformat(),
        "scope": "One case permission: requests and received downloads only. No owned files or authority controls.",
    }


@api(("POST",))
def revoke_credential(request, token_id):
    token = get_object_or_404(CustomerToken, pk=token_id, owner=request.user)
    token.revoked_at = timezone.now()
    token.save(update_fields=["revoked_at"])
    return {"revoked": True}


def received_items(user, policy_id=None):
    collect_received(user)
    items = InboxItem.objects.filter(recipient=user).select_related(
        "transfer__owner", "transfer__contact", "transfer__grant", "transfer__version__document__matter"
    )
    if policy_id:
        items = items.filter(transfer__grant__standing_policy_id=policy_id)
    result = []
    for item in items.order_by("-created_at")[:100]:
        t = item.transfer
        try:
            can_download(user, t)
            available = True
        except PolicyError:
            available = False
        result.append(
            {
                **chat.file_card(t.version),
                "item_id": str(item.pk),
                "from": t.owner.first_name or "File owner",
                "available": available,
                "expires_at": t.expires_at.isoformat(),
                "download_url": f"/api/v1/received/{item.pk}/download/",
            }
        )
    return result


@api()
def received(request):
    return {"files": received_items(request.user)}


def request_result(record, user, agent=False):
    result = dict(record.result)
    files = []
    for outcome in result.get("outcomes", []):
        if "transfer_id" not in outcome:
            continue
        item = (
            InboxItem.objects.filter(transfer_id=outcome["transfer_id"], recipient=user)
            .select_related(
                "transfer__owner",
                "transfer__contact",
                "transfer__grant",
                "transfer__version__document__matter",
            )
            .first()
        )
        if not item:
            continue
        try:
            can_download(user, item.transfer)
        except PolicyError:
            continue
        files.append(
            {
                **chat.file_card(item.transfer.version),
                "sha256": item.transfer.version.sha256,
                "download_url": f"/api/{'agents/' if agent else ''}v1/received/{item.pk}/download/",
            }
        )
    result["files"] = files
    return result


@api(("POST",))
def case_request(request):
    data = body(request)
    return request_result(
        fulfill_case(
            request.user,
            data.get("policy_id"),
            operation(data),
            types=data.get("types"),
            query=data.get("query", ""),
            after=data.get("after", ""),
        ),
        request.user,
    )


@api(kinds=("agent",))
def agent_permissions(request):
    return {"protocol": "fyde-case-request/v1", "permission": policy_card(request.customer_token.policy)}


@api(("POST",), kinds=("agent",))
def agent_request(request):
    data = body(request)
    if set(data) - {"operation_id", "types", "query", "after"}:
        raise PolicyError(
            "invalid_request", "The agent protocol accepts only operation_id, types, query and after."
        )
    return request_result(
        fulfill_case(
            request.user,
            request.customer_token.policy_id,
            operation(data),
            types=data.get("types"),
            query=data.get("query", ""),
            after=data.get("after", ""),
        ),
        request.user,
        agent=True,
    )


@api(kinds=("agent",))
def agent_request_status(request, request_id):
    record = get_object_or_404(
        CaseRequest, pk=request_id, requester=request.user, policy_id=request.customer_token.policy_id
    )
    return request_result(record, request.user, agent=True)


@api(kinds=("device", "agent"))
def download_received(request, item_id):
    from .views import transfer_download

    item = get_object_or_404(InboxItem, pk=item_id, recipient=request.user)
    if (
        request.customer_token.kind == "agent"
        and item.transfer.grant.standing_policy_id != request.customer_token.policy_id
    ):
        raise Http404
    return transfer_download(request, item.transfer_id, inbox_only=True)


@api()
def download_owned(request, version_id):
    from .views import owner_download

    return owner_download(request, version_id)
