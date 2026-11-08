import re
import unicodedata

from django.db.models import F


from .models import Contact, FileVersion


def normalize(text):
    return "".join(
        c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c)
    ).strip()


def visible_versions(owner):
    return FileVersion.objects.filter(
        document__owner=owner, document__deleted_at=None, document__current_version_id=F("pk")
    )


def search_files(owner, query):
    # Tenant scoping precedes all indexing, ranking and excerpts. Document text never becomes an instruction.
    terms = [
        t
        for t in re.findall(r"[\w.-]+", normalize(query))
        if t not in {"find", "my", "latest", "the", "file", "a"}
    ]
    candidates = visible_versions(owner).select_related("document")
    matches = []
    for version in candidates[:1000]:
        label = normalize(f"{version.document.title} {version.original_name} {version.document.tags}")
        body = normalize(version.extracted_text)
        if not terms or all(term in label or term in body for term in terms):
            matches.append(version)
    return matches[:30]


def resolve_command(owner, command, context=None):
    command = command.strip()[:1000]
    channel = None
    suffix = re.search(r"\s+(?:by|via|in)\s+(fyde|(?:the\s+)?app|email|phone|sms)[.!]?$", command, re.I)
    if suffix:
        label = suffix.group(1).lower()
        channel = "email" if label == "email" else "phone" if label in ("phone", "sms") else "in_app"
        command = command[: suffix.start()]
    match = re.fullmatch(r"(send|share|email)\s+(.+?)\s+(?:to|with)\s+(.+?)[.!]?", command, re.I)
    if not match:
        return {
            "action": "search",
            "files": search_files(owner, command),
            "message": "Files matching your search.",
        }
    verb, file_text, recipient_text = match.groups()
    channel = channel or ("email" if verb.lower() == "email" else None)
    recipient_text = recipient_text.strip(" .!")
    file_query = re.sub(r"^(?:my|the)\s+", "", file_text, flags=re.I)
    context = context or {}
    if normalize(file_query) in {"it", "this", "that"}:
        files = (
            list(
                FileVersion.objects.filter(
                    pk=context.get("version_id"), document__owner=owner, document__deleted_at=None
                ).select_related("document")
            )
            if context.get("version_id")
            else []
        )
    else:
        files = search_files(owner, file_query)
    if normalize(recipient_text) in {"him", "her", "them"}:
        contacts = (
            list(Contact.objects.filter(pk=context.get("contact_id"), owner=owner))
            if context.get("contact_id")
            else []
        )
    else:
        query = normalize(recipient_text)
        contacts = [
            c
            for c in Contact.objects.filter(owner=owner)[:1000]
            if query
            in [
                normalize(c.name),
                normalize(c.email),
                normalize(c.phone),
                *[normalize(a) for a in c.aliases.split(",")],
            ]
            or query in normalize(c.name).split()
        ]
    if len(files) != 1 or len(contacts) != 1:
        return {
            "action": "clarify",
            "channel": channel,
            "files": files,
            "contacts": contacts,
            "message": "Choose the exact file and contact below. Pronouns need an explicitly saved context.",
        }
    return {"action": "send", "version": files[0], "contact": contacts[0], "channel": channel}
