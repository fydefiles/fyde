"""Private, bounded conversational file assistant shared by both clients.

Document text supplies search data only. It can never instruct the responder or grant access.
"""

import hashlib
import json
import re
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .commands import normalize, resolve_command
from .delegation import fulfill_case
from .models import (
    DOCUMENT_TYPES,
    ChatExchange,
    Contact,
    FileVersion,
    InboxItem,
    Matter,
    StandingPolicy,
    Transfer,
)
from .policy import PolicyError
from .transfers import create_transfer


def file_card(version):
    return {
        "id": str(version.pk),
        "document_id": str(version.document_id),
        "title": version.document.title,
        "name": version.original_name,
        "number": version.number,
        "size": version.size,
        "state": version.state,
        "document_type": version.document.document_type,
        "matter": version.document.matter.name if version.document.matter_id else "",
        "url": f"/app/documents/{version.document_id}/",
    }


def contact_card(contact):
    return {
        "id": str(contact.pk),
        "name": contact.name,
        "relationship": contact.relationship,
        "endpoint": contact.email or contact.phone,
    }


def history(owner):
    return [
        serialize(t)
        for t in reversed(list(ChatExchange.objects.filter(owner=owner).order_by("-created_at")[:100]))
    ]


def serialize(turn):
    return {
        "id": str(turn.pk),
        "message": turn.message,
        "reply": turn.reply,
        "result": turn.result,
        "created_at": turn.created_at.isoformat(),
    }


def peer_policies(user):
    return StandingPolicy.objects.filter(
        recipient=user, revoked_at=None, expires_at__gt=timezone.now(), data_mode=user.data_mode
    ).select_related("owner", "contact", "matter", "recipient")


def request_spec(text, matter):
    text = re.sub(r"^(?:(?:can|could|would) you\s+|please\s+)", "", text.strip(), flags=re.I)
    text = re.sub(r"^(request|get|ask for)\s+", "", text, flags=re.I)
    subject = re.split(r"\s+(?:from|for|regarding|about)\s+", text, maxsplit=1, flags=re.I)[0]
    words = normalize(subject).strip(" .!?").split()
    known = [key for key, _ in DOCUMENT_TYPES if key != "general" and key in words]
    ignored = {
        "my",
        "the",
        "a",
        "an",
        "all",
        "any",
        "document",
        "documents",
        "file",
        "files",
        "please",
        *normalize(matter.name).split(),
        *known,
    }
    query = " ".join(word for word in words if word not in ignored)
    return known or ["*"], query


def _send(owner, versions, contacts, operation, channel, result):
    if len(contacts) != 1 or not versions or (len(versions) > 1 and not result.get("allow_many")):
        result.update(
            kind="clarify",
            files=[file_card(v) for v in versions[:20]],
            contacts=[contact_card(c) for c in contacts[:30]],
        )
        return "Choose the exact file and recipient. I’ll check permissions before sending."
    batch = versions[:10]
    outcomes = []
    for i, version in enumerate(batch):
        try:
            with transaction.atomic():
                t = create_transfer(owner, version, contacts[0], f"chat/{operation}/{i}", channel=channel)
                outcomes.append(
                    {
                        "id": str(t.pk),
                        "title": version.document.title,
                        "state": t.status,
                        "channel": t.channel,
                        "url": f"/app/transfers/{t.pk}/",
                    }
                )
        except PolicyError as error:
            outcomes.append({"title": version.document.title, "state": error.code, "message": str(error)})
    available = sum(o.get("state") == "available_in_app" for o in outcomes)
    queued = sum(o.get("state") == "queued" for o in outcomes)
    result.update(
        kind="sent",
        transfers=outcomes,
        context={"version_id": str(batch[0].pk), "contact_id": str(contacts[0].pk)},
        remaining_versions=[str(v.pk) for v in versions[10:]],
    )
    if available or queued:
        parts = []
        if available:
            parts.append(
                f"{available} {'file is' if available == 1 else 'files are'} available in {contacts[0].name}’s Fyde inbox."
            )
        if queued:
            parts.append(
                f"{queued} download {'link is' if queued == 1 else 'links are'} queued. The receipt records the delivery result."
            )
        if len(versions) > 10:
            parts.append(f"{len(versions) - 10} more files remain; send the next batch when ready.")
        return " ".join(parts)

    return "The file was not sent. " + " ".join(dict.fromkeys(o.get("message", o["state"]) for o in outcomes))


@transaction.atomic
def converse(owner, message, operation_id, *, channel=None, choice=None):
    if not isinstance(message, str) or not message.strip() or len(message) > 2000:
        raise PolicyError("invalid_message", "Write a message of up to 2,000 characters.")
    channel = channel or owner.default_delivery_channel
    if channel not in ("in_app", "email", "phone") or (choice is not None and not isinstance(choice, dict)):
        raise PolicyError("invalid_message", "Choose a supported channel or file choice.")
    fingerprint = hashlib.sha256(
        json.dumps([message, channel, choice], sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    turn, created = ChatExchange.objects.get_or_create(
        owner=owner,
        operation_id=operation_id,
        defaults={"input_hash": fingerprint, "message": message.strip(), "reply": ""},
    )
    if turn.input_hash != fingerprint:
        raise PolicyError("idempotency_conflict", "This message operation was used for different content.")
    if not created:
        return turn
    recent = (
        ChatExchange.objects.filter(owner=owner, created_at__gt=timezone.now() - timedelta(minutes=15))
        .exclude(pk=turn.pk)
        .exclude(reply="")
        .order_by("-created_at")
        .first()
        if owner.chat_context_enabled
        else None
    )
    if choice:
        recent = ChatExchange.objects.filter(
            owner=owner, pk=choice.get("turn_id"), created_at__gt=timezone.now() - timedelta(minutes=15)
        ).first()
        if not recent:
            raise PolicyError("choice_expired", "That choice expired. Ask again to find the current files.")
    context = recent.result.get("context", {}) if recent else {}
    result = {"kind": "message", "channel": channel}
    text = message.strip()
    for _ in range(2):
        text = re.sub(r"^(?:(?:can|could|would) you\s+|please\s+)", "", text, flags=re.I)
    reply = "I can find a file, send it to a contact, or request documents under a case permission. Try ‘Find my passport’, ‘Send it to my lawyer’, or ‘Request passport for Immigration case’."
    # Chat opens a specific customer form. These cards never change files or grant access by themselves.
    action = None
    if re.match(
        r"^(?:add|upload|import)\s+(?:(?:some|more|my|new)\s+)?(?:files?|documents?)\b", text, re.I
    ) or re.fullmatch(r"(?:create|add)\s+(?:a\s+)?(?:case|project)[.!]?", text, re.I):
        action = (
            "files",
            "Add files →",
            "Choose the files to import and the case they belong to. They remain private until your sharing rules allow a transfer.",
        )
    elif re.fullmatch(
        r"(?:add|manage|edit|update)\s+(?:(?:a|my|new)\s+)?(?:contacts?|people|relationships?)[.!]?",
        text,
        re.I,
    ):
        action = (
            "people",
            "Manage contacts →",
            "Add a contact and relationship here. A relationship label does not grant document access.",
        )
    elif re.fullmatch(
        r"(?:manage|review|change|edit|update|show)\s+(?:my\s+)?(?:permissions|sharing|automatic sharing|case permissions)[.!]?",
        text,
        re.I,
    ):
        action = (
            "permissions",
            "Review sharing permissions →",
            "Review the case, verified recipient and document scope. Changes to automatic sharing require your explicit approval.",
        )
    elif re.fullmatch(
        r"(?:change|edit|update|classify|organize)\s+(?:my\s+)?(?:file details|files|documents|document details)[.!]?",
        text,
        re.I,
    ):
        action = (
            "classify",
            "Change file details →",
            "Review each file’s case, type and sensitivity before saving. Case assignment can make it eligible under an active permission.",
        )
    if re.fullmatch(r"(?:manage|rename|edit|update)\s+(?:my\s+)?(?:cases?|projects?)[.!]?", text, re.I):
        action = (
            "files",
            "Manage cases →",
            "Create or rename a case here. Renaming keeps its assigned files and permissions.",
        )
    if action:
        section, label, reply = action
        result.update(
            kind="workspace_action",
            section=section,
            action_label=label,
            url=f"/app/setup/?step={'files' if section == 'classify' else section}",
        )
    # A reviewed permission is the one-time authority decision; matching requests need no further approval.
    elif re.match(r"^(allow|let|authorize)\b", text, re.I) and re.search(r"request|automatic", text, re.I):
        contacts = [
            c
            for c in Contact.objects.filter(owner=owner)
            if (c.relationship and normalize(c.relationship) in normalize(text))
            or normalize(c.name) in normalize(text)
        ]
        matters = [
            m
            for m in Matter.objects.filter(owner=owner)
            if normalize(m.name) in normalize(text) or normalize(m.name).split()[0] in normalize(text).split()
        ]
        result.update(
            kind="policy_draft",
            contact_id=str(contacts[0].pk) if len(contacts) == 1 else "",
            matter_id=str(matters[0].pk) if len(matters) == 1 else "",
            url="/app/setup/?step=permissions",
        )
        reply = "Review the case, verified contact and document scope once. After you enable the permission, matching requests are fulfilled automatically without asking you again."
    elif re.fullmatch(r".+?\s+is\s+my\s+.+?[.!]?", text, re.I):
        person, relationship = re.split(r"\s+is\s+my\s+", text, maxsplit=1, flags=re.I)
        matches = list(Contact.objects.filter(owner=owner, name__iexact=person.strip()))
        if len(matches) == 1:
            contact = matches[0]
            contact.relationship = relationship.strip(" .!")[:80]
            contact.save(update_fields=["relationship"])
            reply = f"Saved {contact.name} as your {contact.relationship}. Their document access still follows the permissions you enable."
        else:
            reply = "Say ‘Add a contact’ to add that person, or use their exact contact name so I can save the relationship."
    elif re.match(r"^(request|get|ask for)\b", text, re.I) or (choice and choice.get("policy_id")):
        policies = list(peer_policies(owner))
        if choice and choice.get("policy_id"):
            allowed = recent.result.get("policies", [])
            if choice["policy_id"] not in [p["id"] for p in allowed]:
                raise PolicyError("invalid_choice", "Choose one of the offered case permissions.")
            policies = [p for p in policies if str(p.pk) == choice["policy_id"]]
        else:
            specific = [
                p
                for p in policies
                if normalize(p.matter.name) in normalize(text)
                or normalize(p.matter.name).split()[0] in normalize(text).split()
                or (p.owner.first_name and normalize(p.owner.first_name) in normalize(text))
            ]
            if specific:
                policies = specific
        if len(policies) != 1:
            result.update(
                kind="choose_policy",
                policies=[
                    {"id": str(p.pk), "name": p.matter.name, "from": p.owner.first_name or "File owner"}
                    for p in policies
                ],
            )
            reply = (
                "Choose the case permission to use."
                if policies
                else "No active case permission is available for your verified account. The file owner can say ‘Manage permissions’ in chat to enable one."
            )
        else:
            request_text = recent.message if choice and choice.get("policy_id") and recent else text
            requested_types, query = request_spec(request_text, policies[0].matter)
            record = fulfill_case(
                owner, policies[0].pk, f"chat-request/{operation_id}", types=requested_types, query=query
            )

            transfers = Transfer.objects.filter(
                pk__in=[o["transfer_id"] for o in record.result["outcomes"] if "transfer_id" in o]
            ).select_related("version__document")
            received = []
            for t in transfers:
                item = InboxItem.objects.filter(transfer=t, recipient=owner).first()
                if item:
                    received.append(
                        {
                            **file_card(t.version),
                            "item_id": str(item.pk),
                            "download_url": f"/app/received/{item.pk}/download/",
                            "api_download_url": f"/api/v1/received/{item.pk}/download/",
                        }
                    )
            result.update(
                kind="received",
                files=received,
                outcomes=record.result["outcomes"],
                next_cursor=record.result["next_cursor"],
                policy_id=str(policies[0].pk),
            )
            reply = (
                f"{len(received)} {'file' if len(received) == 1 else 'files'} received under {policies[0].matter.name}. The owner’s standing permission handled the request automatically."
                if received
                else record.result["message"]
            )
    elif choice or (
        recent
        and recent.result.get("kind") == "clarify"
        and not re.match(r"^(find|send|share|email)\b", text, re.I)
    ):
        offered = recent.result if recent else {}
        result["allow_many"] = offered.get("allow_many", False) or bool(choice and choice.get("remaining"))
        versions = list(
            FileVersion.objects.filter(
                pk__in=[v["id"] for v in offered.get("files", [])],
                document__owner=owner,
                document__deleted_at=None,
            ).select_related("document__matter")
        )
        contacts = list(
            Contact.objects.filter(pk__in=[c["id"] for c in offered.get("contacts", [])], owner=owner)
        )
        if choice and choice.get("remaining"):
            versions = list(
                FileVersion.objects.filter(
                    pk__in=offered.get("remaining_versions", []),
                    document__owner=owner,
                    document__deleted_at=None,
                ).select_related("document__matter")
            )
            contacts = list(
                Contact.objects.filter(pk=offered.get("context", {}).get("contact_id"), owner=owner)
            )
        else:
            if choice and choice.get("version_id"):
                versions = [v for v in versions if str(v.pk) == choice["version_id"]]
            if choice and choice.get("contact_id"):
                contacts = [c for c in contacts if str(c.pk) == choice["contact_id"]]
            if not choice:
                matched = [
                    c
                    for c in contacts
                    if normalize(text) in (normalize(c.name), normalize(c.relationship), normalize(c.email))
                ]
                if matched:
                    contacts = matched
                matched_versions = [
                    v
                    for v in versions
                    if normalize(text) in normalize(f"{v.document.title} {v.original_name}")
                ]
                if matched_versions:
                    versions = matched_versions
        if len(versions) > 1 and not choice and not re.search(r"\ball\b", text, re.I):
            result.update(
                kind="clarify",
                files=[file_card(v) for v in versions],
                contacts=[contact_card(c) for c in contacts],
            )
            reply = "Which exact file did you mean?"
        else:
            reply = _send(owner, versions, contacts, operation_id, offered.get("channel", channel), result)
    else:
        resolved = resolve_command(owner, text, context)
        if resolved["action"] == "search":
            versions = resolved["files"]
            result.update(kind="search", files=[file_card(v) for v in versions])
            if len(versions) == 1:
                result["context"] = {**context, "version_id": str(versions[0].pk)}
            reply = (
                f"Found {len(versions)} matching {'file' if len(versions) == 1 else 'files'} in your workspace."
                if versions
                else "I couldn’t find a matching file in your workspace. Try its name, document type or case."
            )
        else:
            channel = resolved.get("channel") or channel
            result["channel"] = channel
            versions = [resolved["version"]] if resolved["action"] == "send" else resolved["files"]
            contacts = [resolved["contact"]] if resolved["action"] == "send" else resolved["contacts"]
            multiple = bool(re.search(r"\b(all|documents|files)\b", text, re.I))
            result["allow_many"] = multiple
            if len(versions) > 1 and not multiple:
                result.update(
                    kind="clarify",
                    files=[file_card(v) for v in versions],
                    contacts=[contact_card(c) for c in contacts]
                    or [contact_card(c) for c in Contact.objects.filter(owner=owner)[:30]],
                )
                reply = "I found more than one match. Choose the exact file and contact."
            else:
                reply = _send(owner, versions, contacts, operation_id, channel, result)
    turn.reply, turn.result = reply, result
    turn.save(update_fields=["reply", "result"])
    return turn
