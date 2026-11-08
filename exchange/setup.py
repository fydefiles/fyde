"""Shared setup operations for web and mobile. Case labels are owner decisions, never model guesses."""

from django.db import transaction
from django.utils import timezone

from .models import DOCUMENT_TYPES, Matter
from .policy import PolicyError, audit
from .recipients import refresh_contact_identity
from .storage import add_file


def create_matter(owner, name):
    name = name.strip()
    if not name or len(name) > 120:
        raise PolicyError("invalid_case", "Give this case or project a name of up to 120 characters.")
    existing = Matter.objects.filter(owner=owner, name__iexact=name).first()
    return existing or Matter.objects.create(owner=owner, name=name)


def add_contact(owner, values):
    from .forms import ContactForm

    form = ContactForm(values)
    if not form.is_valid():
        raise PolicyError(
            "invalid_contact", " ".join(str(e) for errors in form.errors.values() for e in errors)
        )
    contact = form.save(commit=False)
    contact.owner = owner
    contact.save()
    return refresh_contact_identity(contact, owner.data_mode)


def classify_document(owner, document, *, matter_id=None, document_type="general", sensitive=False):
    if document.owner_id != owner.pk or document.deleted_at:
        raise PolicyError("not_found", "This document is unavailable.")
    if document_type not in dict(DOCUMENT_TYPES):
        raise PolicyError("invalid_type", "Choose a supported document type.")
    matter = Matter.objects.filter(owner=owner, pk=matter_id).first() if matter_id else None
    if matter_id and not matter:
        raise PolicyError("not_found", "Choose one of your own cases.")
    document.matter, document.document_type, document.sensitive = matter, document_type, sensitive
    document.save(update_fields=["matter", "document_type", "sensitive"])
    audit(
        owner,
        "document.classified",
        document.pk,
        "owner_assigned",
        matter_id=str(matter.pk) if matter else "",
    )
    return document


def upload_document(owner, upload, *, matter_id=None, document_type="general", sensitive=False):
    # Validate authority before writing bytes. Each file succeeds or fails independently in a bulk import.
    if document_type not in dict(DOCUMENT_TYPES) or (
        matter_id and not Matter.objects.filter(owner=owner, pk=matter_id).exists()
    ):
        raise PolicyError("invalid_classification", "Choose your own case and a supported document type.")
    version = add_file(owner, upload, sensitive=sensitive)
    classify_document(
        owner, version.document, matter_id=matter_id, document_type=document_type, sensitive=sensitive
    )
    return version


@transaction.atomic
def complete_setup(owner):
    owner.onboarding_completed_at = timezone.now()
    owner.save(update_fields=["onboarding_completed_at"])
    audit(owner, "setup.completed", owner.pk, "owner_completed")
