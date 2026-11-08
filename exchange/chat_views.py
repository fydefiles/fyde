import json
import uuid

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

from . import api, chat, setup
from .customer_access import issue_token
from .delegation import revoke_policy
from .identity import rate_limit
from .models import CustomerToken, Document, StandingPolicy
from .policy import PolicyError


@login_required
def home(request):
    return render(
        request, "exchange/chat.html", {"turns": chat.history(request.user), "operation_id": uuid.uuid4()}
    )


@login_required
@require_POST
def message(request):
    try:
        data = json.loads(request.body) if request.content_type == "application/json" else request.POST
        rate_limit(f"customer-chat:{request.user.pk}", 60, 60)
        turn = chat.converse(
            request.user,
            data.get("message", ""),
            api.operation(data),
            channel=data.get("channel"),
            choice=data.get("choice"),
        )
        return JsonResponse(chat.serialize(turn))
    except PolicyError as error:
        return JsonResponse({"error": error.code, "message": str(error)}, status=400)
    except (ValueError, ValidationError, TypeError):
        return JsonResponse(
            {"error": "invalid_message", "message": "Check your message and selected file or contact."},
            status=400,
        )


@login_required
@require_POST
def clear(request):
    # The owner explicitly controls this private conversation; company agents cannot reach it.
    request.user.chatexchange_set.all().delete()
    request.user.chat_context_enabled = request.POST.get("remember") == "on"
    request.user.save(update_fields=["chat_context_enabled"])
    messages.success(
        request,
        "Chat history cleared. Recent-chat context is "
        + ("on." if request.user.chat_context_enabled else "off."),
    )
    return redirect("dashboard")


def setup_context(request, **extra):
    state = api.workspace(request.user)
    stage = request.GET.get("step", request.POST.get("step", "files"))
    if stage not in ("files", "people", "permissions"):
        stage = "files"
    return {
        "state": state,
        "stage": stage,
        "operation_id": uuid.uuid4(),
        "chosen_contact": request.GET.get("contact_id", ""),
        "chosen_matter": request.GET.get("matter_id", ""),
        **extra,
    }


@login_required
def onboarding(request):
    return render(request, "exchange/setup.html", setup_context(request))


@login_required
@require_POST
def setup_action(request):
    action = request.POST.get("action")
    try:
        if action == "matter":
            setup.create_matter(request.user, request.POST.get("name", ""))
            messages.success(request, "Case created. Assign only the files that belong to it.")
        elif action == "contact":
            setup.add_contact(request.user, request.POST)
            messages.success(request, "Contact and relationship saved.")
        elif action == "classify":
            doc = get_object_or_404(
                Document, pk=request.POST.get("document_id"), owner=request.user, deleted_at=None
            )
            setup.classify_document(
                request.user,
                doc,
                matter_id=request.POST.get("matter_id") or None,
                document_type=request.POST.get("document_type", "general"),
                sensitive=request.POST.get("sensitive") == "on",
            )
            messages.success(request, "Document case and type updated.")
        elif action == "policy":
            data = {
                "contact_id": request.POST.get("contact_id"),
                "matter_id": request.POST.get("matter_id"),
                "operation_id": request.POST.get("operation_id"),
                "types": request.POST.getlist("types") or ["*"],
                "days": int(request.POST.get("days", 90)),
                "max_requests": int(request.POST.get("max_requests", 100)),
                "future_files": request.POST.get("future_files") == "on",
                "future_versions": request.POST.get("future_versions") == "on",
                "sensitive": request.POST.get("sensitive") == "on",
                "confirm": request.POST.get("confirm") == "on",
            }
            api.policy_from_data(request.user, data)
            messages.success(
                request,
                "Automatic case sharing enabled. Matching verified requests need no further approval.",
            )
        elif action == "revoke":
            get_object_or_404(StandingPolicy, pk=request.POST.get("policy_id"), owner=request.user)
            revoke_policy(request.user, request.POST["policy_id"])
            messages.success(request, "Case permission revoked; future requests and downloads are blocked.")
        elif action == "complete":
            setup.complete_setup(request.user)
            return redirect("dashboard")
        else:
            raise PolicyError("invalid_action", "Choose a setup action.")
        return redirect(f"{reverse('onboarding')}?step={request.POST.get('step', 'files')}")
    except (PolicyError, ValueError, ValidationError, IntegrityError) as error:
        messages.error(
            request,
            str(error)
            if isinstance(error, PolicyError)
            else "Check the values and use an available contact endpoint.",
        )
        return render(request, "exchange/setup.html", setup_context(request), status=400)


@login_required
@require_POST
def setup_upload(request):
    outcomes = []
    if len(request.FILES.getlist("file")) > 20:
        return JsonResponse(
            {"files": [], "message": "Use the sequential importer or select up to 20 files per request."},
            status=400,
        )
    for upload in request.FILES.getlist("file"):
        try:
            v = setup.upload_document(
                request.user,
                upload,
                matter_id=request.POST.get("matter_id") or None,
                document_type=request.POST.get("document_type", "general"),
                sensitive=request.POST.get("sensitive") == "on",
            )
            outcomes.append({"name": upload.name, "state": v.state, "ok": True})
        except (PolicyError, ValidationError, ValueError) as error:
            outcomes.append({"name": upload.name, "message": str(error), "ok": False})
    if request.headers.get("Accept") == "application/json":
        return JsonResponse({"files": outcomes}, status=200 if outcomes else 400)
    for outcome in outcomes:
        (messages.success if outcome["ok"] else messages.error)(
            request, f"{outcome['name']}: {outcome['state'] if outcome['ok'] else outcome['message']}"
        )
    return redirect("onboarding")


@login_required
def agents(request):
    token_value = None
    try:
        if request.method == "POST":
            if request.POST.get("action") == "revoke":
                token = get_object_or_404(CustomerToken, pk=request.POST.get("token_id"), owner=request.user)
                token.revoked_at = timezone.now()
                token.save(update_fields=["revoked_at"])
                messages.success(request, "Credential revoked.")
            else:
                policy = get_object_or_404(
                    StandingPolicy, pk=request.POST.get("policy_id"), recipient=request.user
                )
                _, token_value = issue_token(
                    request.user, kind="agent", name=request.POST.get("name", "Case agent"), policy=policy
                )
    except (PolicyError, ValueError, ValidationError) as error:
        messages.error(request, str(error))
    return render(
        request,
        "exchange/agents.html",
        {
            "policies": api.available_policies(request.user),
            "new_token": token_value,
            "tokens": CustomerToken.objects.filter(owner=request.user, kind="agent", revoked_at=None),
        },
    )
