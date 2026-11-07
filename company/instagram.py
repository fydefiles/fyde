import os
import re
from datetime import timedelta
from urllib.parse import urlparse

import httpx
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import Publication, SourceClaim
from .policy import Blocked, emit, ensure_running


def ready():
    return bool(
        settings.INSTAGRAM_ENABLED
        and settings.INSTAGRAM_ACCESS_TOKEN
        and settings.INSTAGRAM_ACCOUNT_ID
        and re.fullmatch(r"v\d+\.0", settings.INSTAGRAM_API_VERSION)
        and os.environ.get("INSTAGRAM_PERMISSIONS_APPROVED") == "1"
    )


def graph(method, path, **kwargs):
    response = httpx.request(
        method,
        f"https://graph.facebook.com/{settings.INSTAGRAM_API_VERSION}/{path}",
        headers={"Authorization": f"Bearer {settings.INSTAGRAM_ACCESS_TOKEN}"},
        timeout=25,
        **kwargs,
    )
    response.raise_for_status()
    return response.json()


def check_public_destination(carousel):
    parsed = urlparse(carousel.destination)
    # An operator configures these origins; an untrusted source page cannot redirect publication or fetches.
    configured = urlparse(settings.MARKETING_DESTINATION)
    if (
        parsed.scheme != "https"
        or parsed.hostname != configured.hostname
        or parsed.username
        or parsed.hostname in ("localhost", "127.0.0.1", "::1")
        or not settings.CONTENT_PUBLIC_ORIGIN.startswith("https://")
    ):
        raise Blocked(
            "public_destination_required", "Publishing requires public HTTPS product and media origins."
        )
    response = httpx.get(carousel.destination, timeout=15, follow_redirects=False)
    if not response.is_success:
        raise Blocked("product_unavailable", "The product CTA destination is not reachable.")


def reconcile(publication):
    if not publication.parent_container_id:
        return False
    observed = graph("GET", publication.parent_container_id, params={"fields": "status_code,status"})
    if observed.get("status_code") != "PUBLISHED":
        return False
    posts = graph(
        "GET",
        f"{settings.INSTAGRAM_ACCOUNT_ID}/media",
        params={"fields": "id,caption,permalink", "limit": 25},
    )
    matches = [p for p in posts.get("data", []) if p.get("caption") == publication.carousel.caption]
    if len(matches) != 1:
        return False
    post = matches[0]
    publication.provider_post_id, publication.permalink = post["id"], post.get("permalink", "")
    publication.status, publication.published_at = "published", timezone.now()
    publication.save()
    publication.carousel.status = "published"
    publication.carousel.save(update_fields=["status"])
    return True


def publish(carousel):
    ensure_running("marketing")
    if not ready():
        raise Blocked(
            "instagram_not_authorized",
            "Configure approved Facebook Login / Page access for a linked professional Instagram account, API version, and explicit publishing activation.",
        )
    if carousel.status not in ("quality_passed", "scheduled", "publishing", "published"):
        raise Blocked(
            "quality_required", "Only source-verified, quality-checked carousel assets may publish."
        )
    claims = SourceClaim.objects.filter(pk__in=carousel.claim_ids)
    if (
        claims.count() != len(carousel.claim_ids)
        or claims.exclude(status="verified").exists()
        or claims.filter(verified_at__lt=timezone.now() - timedelta(days=7)).exists()
    ):
        raise Blocked("sources_unverified", "Refresh and verify every claim before publishing.")
    check_public_destination(carousel)
    with transaction.atomic(using="company"):
        publication, _ = Publication.objects.select_for_update().get_or_create(carousel=carousel)
        if publication.status == "published":
            return True
        if publication.status in ("publishing", "uncertain"):
            # Never blindly repeat a publication when provider acceptance is unknown.
            return reconcile(publication)
        start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        day_count = (
            Publication.objects.filter(last_side_effect_at__gte=start).exclude(pk=publication.pk).count()
        )
        if day_count >= settings.INSTAGRAM_MAX_PER_DAY:
            raise Blocked("posting_cadence", "The operator's daily publication limit has been reached.")
        if (
            Publication.objects.exclude(pk=publication.pk)
            .filter(status__in=["publishing", "uncertain", "preparing"])
            .exists()
        ):
            raise Blocked(
                "publication_in_flight", "Reconcile the active publication before starting another."
            )
        publication.status = "preparing"
        publication.last_side_effect_at = timezone.now()
        publication.failure_code = ""
        publication.save()
    # Facebook Login path only. The account must be a professional account linked to the authorized Page.
    graph("GET", settings.INSTAGRAM_ACCOUNT_ID, params={"fields": "id,username"})
    try:
        while len(publication.container_ids) < len(carousel.quality["assets"]):
            index = len(publication.container_ids)
            asset = carousel.quality["assets"][index]
            url = (
                f"{settings.CONTENT_PUBLIC_ORIGIN.rstrip('/')}/marketing-assets/{carousel.pk}/{asset['file']}"
            )
            observed = httpx.get(url, timeout=15, follow_redirects=False)
            import hashlib

            if not observed.is_success or hashlib.sha256(observed.content).hexdigest() != asset["sha256"]:
                raise Blocked("public_asset_mismatch", "Public media does not match the verified asset hash.")
            child = graph(
                "POST",
                f"{settings.INSTAGRAM_ACCOUNT_ID}/media",
                data={"image_url": url, "is_carousel_item": "true", "alt_text": asset["alt"][:1000]},
            )
            publication.container_ids.append(child["id"])
            publication.save(update_fields=["container_ids"])
        for container in publication.container_ids:
            status = graph("GET", container, params={"fields": "status_code"}).get("status_code")
            if status == "ERROR" or status == "EXPIRED":
                raise Blocked("media_processing_failed", "Instagram rejected a media container.")
            if status != "FINISHED":
                publication.status = "scheduled"
                publication.save(update_fields=["status"])
                return False
        if not publication.parent_container_id:
            parent = graph(
                "POST",
                f"{settings.INSTAGRAM_ACCOUNT_ID}/media",
                data={
                    "media_type": "CAROUSEL",
                    "children": ",".join(publication.container_ids),
                    "caption": carousel.caption,
                },
            )
            publication.parent_container_id = parent["id"]
            publication.save(update_fields=["parent_container_id"])
        parent_state = graph("GET", publication.parent_container_id, params={"fields": "status_code"}).get(
            "status_code"
        )
        if parent_state != "FINISHED":
            publication.status = "scheduled"
            publication.save(update_fields=["status"])
            return False
        publication.status = "publishing"
        publication.save(update_fields=["status"])
        carousel.status = "publishing"
        carousel.save(update_fields=["status"])
        result = graph(
            "POST",
            f"{settings.INSTAGRAM_ACCOUNT_ID}/media_publish",
            data={"creation_id": publication.parent_container_id},
        )
        publication.provider_post_id = result["id"]
        publication.status, publication.published_at = "published", timezone.now()
        publication.save()
        details = graph("GET", publication.provider_post_id, params={"fields": "permalink"})
        publication.permalink = details.get("permalink", "")
        publication.save(update_fields=["permalink"])
        carousel.status, carousel.blocker = "published", ""
        carousel.save(update_fields=["status", "blocker"])
        emit(
            "content.published",
            f"published/{publication.pk}",
            mode="live",
            payload={"publication_id": str(publication.pk), "provider_post_id": publication.provider_post_id},
        )
        return True
    except httpx.HTTPError:
        publication.status = "uncertain"
        publication.failure_code = "provider_outcome_uncertain"
        publication.save(update_fields=["status", "failure_code"])
        raise Blocked(
            "instagram_uncertain",
            "Instagram's outcome is uncertain. Reconcile the existing containers and post before retrying.",
        ) from None


def measure(publication):
    ensure_running("marketing")
    if publication.status != "published" or not publication.provider_post_id or not ready():
        raise Blocked("not_published", "Performance is unknown until a real authorized post exists.")
    metrics = {
        "reach": None,
        "saved": None,
        "shares": None,
        "total_interactions": None,
        "profile_visits": None,
        "paid_conversion": None,
        "slide_completion": None,
    }
    errors = []
    for metric in ("reach", "saved", "shares", "total_interactions"):
        try:
            response = graph("GET", f"{publication.provider_post_id}/insights", params={"metric": metric})
            row = next((row for row in response.get("data", []) if row.get("name") == metric), {})
            values = row.get("values", [])
            metrics[metric] = values[0].get("value") if values else row.get("total_value", {}).get("value")
        except httpx.HTTPError:
            errors.append(metric)
    metrics["unavailable_metrics"] = errors
    metrics["attribution"] = (
        "Aggregate campaign visits are tracked separately; individual revenue and slide completion remain unknown."
    )
    publication.metrics, publication.metrics_observed_at = metrics, timezone.now()
    publication.save(update_fields=["metrics", "metrics_observed_at"])
    return metrics
