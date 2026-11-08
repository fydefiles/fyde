import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Challenge, Contact, Mail, RateLimit, User
from .policy import PolicyError, audit


def data_mode(channel="email"):
    selected = settings.SMS_ADAPTER if channel == "phone" else settings.EMAIL_ADAPTER
    return "fixture" if selected == "local" else "live"


@transaction.atomic
def rate_limit(key, limit=6, seconds=900):
    now = timezone.now()
    bucket, _ = RateLimit.objects.select_for_update().get_or_create(
        key=hashlib.sha256(key.encode()).hexdigest(), defaults={"window": now}
    )
    if bucket.window < now - timedelta(seconds=seconds):
        bucket.window, bucket.count = now, 0
    if bucket.count >= limit:
        raise PolicyError("rate_limited", "Too many attempts. Try again later.")
    bucket.count += 1
    bucket.save()


def queue_mail(owner, destination, subject, body, key, transfer=None, channel="email"):
    if channel not in ("email", "phone") or not destination:
        raise PolicyError("endpoint_missing", "Add the selected email address or phone number first.")
    mail, _ = Mail.objects.get_or_create(
        idempotency_key=key,
        defaults={
            "owner": owner,
            "destination": destination,
            "subject": subject,
            "body": body,
            "transfer": transfer,
            "data_mode": data_mode(channel),
            "channel": channel,
        },
    )
    return mail


def issue_challenge(owner, scope, *, contact=None, transfer=None, channel="email", destination=None):
    if transfer:
        channel = transfer.grant.identity_kind
    if channel not in ("email", "phone"):
        raise PolicyError("unsupported_channel", "Choose email or phone verification.")
    destination = destination or (
        (contact.phone if channel == "phone" else contact.email) if contact else owner.email
    )
    if channel == "phone":
        from .sms import adapter

        adapter()  # A disconnected phone channel cannot issue a usable challenge.
        from .recipients import phone_number

        destination = phone_number(destination)
    if not destination:
        raise PolicyError("endpoint_missing", "The selected contact endpoint is missing.")
    if data_mode(channel) != owner.data_mode:
        raise PolicyError(
            "verification_mode_mismatch", "A fixture verification adapter cannot verify a live identity."
        )
    rate_limit(f"challenge:{scope}:{channel}:{contact.pk if contact else owner.pk}", 5)
    token = secrets.token_urlsafe(32)
    code = f"{secrets.randbelow(1000000):06d}"
    challenge = Challenge.objects.create(
        owner=owner,
        contact=contact,
        transfer=transfer,
        scope=scope,
        channel=channel,
        destination=destination,
        data_mode=data_mode(channel),
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        code_hash=make_password(code),
        endpoint_revision=contact.endpoint_revision if contact else 0,
        expires_at=timezone.now() + timedelta(minutes=15),
    )
    link = f"{settings.SITE_URL}/verify/{challenge.pk}/{token}/"
    body = f"Your Fyde verification code is {code}. It expires in 15 minutes.\n\nOpen {link}\n\nIf you did not expect this message, ignore it."
    queue_mail(
        owner,
        destination,
        "Verify your contact endpoint for Fyde",
        body,
        f"challenge/{challenge.pk}",
        channel=channel,
    )
    return challenge


def consume_challenge(challenge_id, token, code):
    error, result = None, None
    with transaction.atomic():
        challenge = (
            Challenge.objects.select_for_update(of=("self",))
            .select_related("contact", "owner")
            .get(pk=challenge_id)
        )
        if challenge.consumed_at or challenge.expires_at <= timezone.now() or challenge.attempts >= 5:
            error = "Verification expired. Request a new code."
        elif challenge.data_mode != challenge.owner.data_mode:
            error = "This verification cannot authorize a different identity mode."
        elif not secrets.compare_digest(challenge.token_hash, hashlib.sha256(token.encode()).hexdigest()):
            error = "Verification is unavailable."
        else:
            challenge.attempts += 1
            challenge.save(update_fields=["attempts"])
            if not check_password(code, challenge.code_hash):
                error = "The code is incorrect."
            elif challenge.contact and challenge.contact.endpoint_revision != challenge.endpoint_revision:
                error = "The contact endpoint changed. Request a new verification."
            else:
                if challenge.scope == "phone_identity":
                    try:
                        with transaction.atomic():
                            user = User.objects.select_for_update().get(pk=challenge.owner_id)
                            if not user.email_verified:
                                raise PolicyError(
                                    "owner_verification_required",
                                    "Verify your account email before linking a phone.",
                                )
                            user.phone, user.phone_verified_at = challenge.destination, timezone.now()
                            user.save(update_fields=["phone", "phone_verified_at"])
                    except (IntegrityError, PolicyError):
                        error = "This phone cannot be linked to this account. Verify your account email and try again."
                elif challenge.scope == "owner" and challenge.channel == "email":
                    challenge.owner.email_verified = True
                    challenge.owner.save(update_fields=["email_verified"])
                elif challenge.scope in ("contact", "access", "request") and challenge.contact:
                    field = "phone_verified_at" if challenge.channel == "phone" else "verified_at"
                    Contact.objects.filter(
                        pk=challenge.contact_id, endpoint_revision=challenge.endpoint_revision
                    ).update(**{field: timezone.now()})
                else:
                    error = "This verification scope is unavailable."
                if not error:
                    challenge.consumed_at = timezone.now()
                    challenge.save(update_fields=["consumed_at"])
                    audit(
                        challenge.owner,
                        "identity.verified",
                        challenge.pk,
                        challenge.scope,
                        channel=challenge.channel,
                    )
                    result = challenge
    if error:
        raise PolicyError("verification_failed", error)
    return result
