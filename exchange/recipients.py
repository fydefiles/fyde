"""Verified endpoint resolution; names and contact labels are never identity proof."""

import re

from django.db.models import Q
from django.utils import timezone

from .models import User
from .policy import PolicyError


def phone_number(value):
    value = re.sub(r"[ ()-]", "", value.strip())
    if value and not re.fullmatch(r"\+[1-9]\d{7,14}", value):
        raise PolicyError(
            "invalid_phone", "Use a phone number with its country code, for example +14155550123."
        )
    return value


def account_for(contact, mode, kind):
    users = User.objects.filter(is_active=True, data_mode=mode)
    if kind == "phone":
        users = (
            users.filter(phone=contact.phone, phone_verified_at__isnull=False)
            if contact.phone
            else users.none()
        )
    else:
        users = (
            users.filter(email__iexact=contact.email, email_verified=True) if contact.email else users.none()
        )
    matches = list(users[:2])
    return matches[0] if len(matches) == 1 else None


def refresh_contact_identity(contact, mode):
    fields = []
    for kind, field in [("email", "verified_at"), ("phone", "phone_verified_at")]:
        if account_for(contact, mode, kind) and not getattr(contact, field):
            setattr(contact, field, timezone.now())
            fields.append(field)
    if fields:
        contact.save(update_fields=fields)
    return contact


def resolve_app_recipient(contact, mode):
    email_user = account_for(contact, mode, "email")
    phone_user = account_for(contact, mode, "phone")
    if email_user and phone_user and email_user.pk != phone_user.pk:
        raise PolicyError(
            "recipient_identity_conflict",
            "This contact's email and phone identify different Fyde accounts. Update the contact before sending.",
        )
    if email_user:
        return email_user, "email"
    if phone_user:
        return phone_user, "phone"
    raise PolicyError(
        "recipient_not_on_fyde",
        "This contact needs a verified Fyde account for in-app delivery. Choose email or phone to send a download link instead.",
    )


def matches_recipient(user, transfer):
    if not user.is_authenticated or not user.is_active or user.data_mode != transfer.data_mode:
        return False
    if transfer.grant.identity_kind == "phone":
        return bool(user.phone_verified_at and user.phone and user.phone == transfer.recipient_phone)
    return bool(user.email_verified and user.email.lower() == transfer.recipient_email.lower())


def pending_for(user):
    identity = Q()
    if user.email_verified:
        identity |= Q(grant__identity_kind="email", recipient_email__iexact=user.email)
    if user.phone_verified_at and user.phone:
        identity |= Q(grant__identity_kind="phone", recipient_phone=user.phone)
    return identity if identity else Q(pk__isnull=True)
