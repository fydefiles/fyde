import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone

from .models import Challenge, Contact, Mail, RateLimit
from .policy import PolicyError, audit


def data_mode():
    return "fixture" if settings.EMAIL_ADAPTER == "local" else "live"


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


def queue_mail(owner, destination, subject, body, key, transfer=None):
    mail, _ = Mail.objects.get_or_create(
        idempotency_key=key,
        defaults={
            "owner": owner,
            "destination": destination,
            "subject": subject,
            "body": body,
            "transfer": transfer,
            "data_mode": data_mode(),
        },
    )
    return mail


def issue_challenge(owner, scope, *, contact=None, transfer=None):
    rate_limit(f"challenge:{scope}:{contact.pk if contact else owner.pk}", 5)
    token = secrets.token_urlsafe(32)
    code = f"{secrets.randbelow(1000000):06d}"
    challenge = Challenge.objects.create(
        owner=owner,
        contact=contact,
        transfer=transfer,
        scope=scope,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        code_hash=make_password(code),
        endpoint_revision=contact.endpoint_revision if contact else 0,
        expires_at=timezone.now() + timedelta(minutes=15),
    )
    link = f"{settings.SITE_URL}/verify/{challenge.pk}/{token}/"
    body = f"Your Fyde verification code is {code}. It expires in 15 minutes.\n\nOpen {link}\n\nIf you did not expect this message, ignore it."
    queue_mail(
        owner,
        contact.email if contact else owner.email,
        "Verify your email for Fyde",
        body,
        f"challenge/{challenge.pk}",
    )
    return challenge


def consume_challenge(challenge_id, token, code):
    # Commit failed-attempt counters before returning a failure.
    error = None
    result = None
    with transaction.atomic():
        challenge = (
            Challenge.objects.select_for_update(of=("self",))
            .select_related("contact", "owner")
            .get(pk=challenge_id)
        )
        if challenge.consumed_at or challenge.expires_at <= timezone.now() or challenge.attempts >= 5:
            error = "Verification expired. Request a new code."
        elif not secrets.compare_digest(challenge.token_hash, hashlib.sha256(token.encode()).hexdigest()):
            error = "Verification is unavailable."
        else:
            challenge.attempts += 1
            challenge.save(update_fields=["attempts"])
            if not check_password(code, challenge.code_hash):
                error = "The code is incorrect."
            elif challenge.contact and challenge.contact.endpoint_revision != challenge.endpoint_revision:
                error = "The contact address changed. Request a new verification."
            else:
                challenge.consumed_at = timezone.now()
                challenge.save(update_fields=["consumed_at"])
                if challenge.scope == "owner":
                    challenge.owner.email_verified = True
                    challenge.owner.save(update_fields=["email_verified"])
                elif challenge.scope in ("contact", "access", "request"):
                    Contact.objects.filter(
                        pk=challenge.contact_id, endpoint_revision=challenge.endpoint_revision
                    ).update(verified_at=timezone.now())
                audit(challenge.owner, "identity.verified", challenge.pk, challenge.scope)
                result = challenge
    if error:
        raise PolicyError("verification_failed", error)
    return result
