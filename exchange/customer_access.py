import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone

from .delegation import check_policy
from .models import CustomerToken
from .policy import PolicyError, audit


def issue_token(owner, *, kind="device", name="Mobile device", policy=None, neon_session=None):
    if kind not in ("device", "agent") or (kind == "agent") != bool(policy):
        raise PolicyError("invalid_scope", "Choose a mobile session or one received case permission.")
    if policy:
        check_policy(policy, requester=owner)
    raw = f"fyde_{kind}_{secrets.token_urlsafe(40)}"
    expiry = timezone.now() + timedelta(days=30)
    token = CustomerToken.objects.create(
        owner=owner,
        neon_session=neon_session,
        kind=kind,
        name=name[:80],
        policy=policy,
        policy_revision=policy.revision if policy else 0,
        data_mode=owner.data_mode,
        token_hash=hashlib.sha256(raw.encode()).hexdigest(),
        expires_at=min(expiry, policy.expires_at)
        if policy
        else min(expiry, neon_session.expires_at)
        if neon_session
        else expiry,
    )
    audit(owner, "customer_credential.issued", token.pk, kind)
    return token, raw


def authenticate_token(header, kinds=("device",), *, validate_provider=True):
    if not header.startswith("Bearer ") or len(header) > 250:
        raise PolicyError(
            "authentication_required", "Sign in again or supply the authorized recipient agent credential."
        )
    digest = hashlib.sha256(header[7:].encode()).hexdigest()
    token = (
        CustomerToken.objects.select_related(
            "owner",
            "policy__owner",
            "policy__recipient",
            "policy__contact",
            "policy__matter",
            "neon_session__owner",
        )
        .filter(token_hash=digest, revoked_at=None, expires_at__gt=timezone.now())
        .first()
    )
    if not token or not token.owner.is_active or token.data_mode != token.owner.data_mode:
        raise PolicyError("authentication_required", "This credential expired or was revoked.")
    if token.kind not in kinds:
        raise PolicyError("scope_denied", "This credential cannot access that customer operation.")
    if token.kind == "device":
        from . import neon_auth

        if neon_auth.enabled() and validate_provider:
            if not token.neon_session_id or token.neon_session.owner_id != token.owner_id:
                raise PolicyError("authentication_required", "Sign in again with your Neon account.")
            neon_auth.validate_session(token.neon_session)
    if token.kind == "agent":
        if not token.policy_id or token.policy_revision != token.policy.revision:
            raise PolicyError("scope_denied", "The case permission changed. Obtain a new scoped credential.")
        check_policy(token.policy, requester=token.owner)
    return token
