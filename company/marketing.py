import hashlib
import html
import json
import re
import shutil
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlencode, urlparse

import httpx
from django.conf import settings
from django.utils import timezone
from PIL import Image, ImageDraw, ImageFont

from .models import Carousel, Publication, SourceClaim
from .policy import Blocked, emit, ensure_running

SOURCE_HOSTS = {"support.google.com", "help.dropbox.com"}


def fetch_source(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in SOURCE_HOSTS or parsed.username or parsed.port:
        raise Blocked(
            "source_not_allowed", "Research fetches are restricted to the configured primary-source hosts."
        )
    with httpx.stream(
        "GET", url, timeout=20, follow_redirects=False, headers={"User-Agent": "FydeResearch/0.1"}
    ) as response:
        if not response.is_success or "text/html" not in response.headers.get("Content-Type", ""):
            raise Blocked(
                "source_unavailable",
                "The primary source is unavailable or redirected; the claim remains unverified.",
            )
        raw = b""
        for chunk in response.iter_bytes():
            raw += chunk
            if len(raw) > 3 * 1024 * 1024:
                raise Blocked("source_too_large", "The research source exceeded the safe fetch limit.")
    text = raw.decode("utf-8", errors="replace")
    text = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", text, flags=re.I)
    text = html.unescape(re.sub(r"<[^>]*>", " ", text))
    return re.sub(r"\s+", " ", text), hashlib.sha256(raw).hexdigest()


def research():
    ensure_running("marketing")
    catalog = json.loads((settings.BASE_DIR / "content/research.json").read_text())
    fetched = {}
    claims = []
    for source in catalog["claims"]:
        claim, _ = SourceClaim.objects.get_or_create(
            key=source["key"],
            defaults={
                key: source[key]
                for key in (
                    "topic",
                    "claim",
                    "qualification",
                    "source_url",
                    "publisher",
                    "title",
                    "source_date",
                )
            },
        )
        if source["source_url"] not in fetched:
            fetched[source["source_url"]] = fetch_source(source["source_url"])
        text, digest = fetched[source["source_url"]]
        supported = all(fragment.lower() in text.lower() for fragment in source["support"])
        claim.retrieved_at = timezone.now()
        claim.source_sha256 = digest
        claim.status = "verified" if supported else "unsupported"
        claim.verified_at = timezone.now() if supported else None
        claim.verification_method = "curated_primary_source_anchors"
        claim.evidence_excerpt = source["excerpt"] if supported else ""
        claim.save()
        if not supported:
            raise Blocked(
                "unsupported_claim", f"The primary source no longer supports configured claim {claim.key}."
            )
        claims.append(claim)
    return claims


def font(size, serif=False):
    candidates = (
        ["/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", "/System/Library/Fonts/Supplemental/Georgia.ttf"]
        if serif
        else [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ]
    )
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise Blocked("font_missing", "Install DejaVu Sans and Serif for deterministic readable carousel text.")


def lines(draw, text, face, width):
    output, current = [], ""
    for word in text.split():
        proposal = (current + " " + word).strip()
        if draw.textlength(proposal, font=face) <= width:
            current = proposal
        else:
            if not current or draw.textlength(word, font=face) > width:
                raise Blocked("text_overflow", "An unbreakable word exceeds the carousel text area.")
            output.append(current)
            current = word
    if current:
        output.append(current)
    return output


def render_slides(carousel):
    folder = settings.VAR_DIR / "marketing" / str(carousel.pk)
    folder.mkdir(parents=True, exist_ok=True)
    quality = {
        "dimensions": [1080, 1350],
        "format": "JPEG",
        "text_overflow": False,
        "minimum_font_px": 27,
        "contrast_ratio_min": None,
        "assets": [],
        "checks": "deterministic bounds, character limits, source freshness, final CTA",
    }
    for index, slide in enumerate(carousel.slides):
        dark = index in (0, len(carousel.slides) - 1)
        bg, ink, accent, muted = (
            ("#29362d", "#faf8ed", "#edb17e", "#e4e9d9")
            if dark
            else ("#f7f3e9", "#29362d", "#9c351c", "#4a594a")
        )

        def luminance(color):
            values = [int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
            linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values]
            return sum(v * w for v, w in zip(linear, (0.2126, 0.7152, 0.0722)))

        ratios = [
            (max(luminance(bg), luminance(color)) + 0.05) / (min(luminance(bg), luminance(color)) + 0.05)
            for color in (ink, accent, muted)
        ]
        minimum = min(ratios)
        if minimum < 4.5:
            raise Blocked("low_contrast", "The carousel template fails minimum text contrast.")
        quality["contrast_ratio_min"] = round(min(minimum, quality["contrast_ratio_min"] or minimum), 2)
        canvas = Image.new("RGB", (1080, 1350), bg)
        draw = ImageDraw.Draw(canvas)
        draw.text((85, 70), "fyde.", font=font(40), fill=ink)
        draw.text((840, 82), f"{index + 1:02} / {len(carousel.slides):02}", font=font(27), fill=muted)
        draw.line((85, 155, 995, 155), fill=muted, width=1)
        draw.text(
            (85, 215), slide.get("eyebrow", "A BETTER WAY TO SHARE").upper(), font=font(27), fill=accent
        )
        y = 305
        for line in lines(draw, slide["title"], font(80, True), 900):
            if y + 105 > 750:
                raise Blocked("text_overflow", "Slide heading does not fit the mobile template.")
            draw.text((80, y), line, font=font(80, True), fill=ink)
            y += 102
        y += 35
        for line in lines(draw, slide["body"], font(38), 885):
            if y + 56 > 1080:
                raise Blocked("text_overflow", "Slide body does not fit the mobile template.")
            draw.text((85, y), line, font=font(38), fill=ink)
            y += 57
        source = slide.get("source", "Practical advice from Fyde")
        y = 1150
        for line in lines(draw, source, font(27), 900):
            if y > 1270:
                raise Blocked("text_overflow", "Slide attribution does not fit.")
            draw.text((85, y), line, font=font(27), fill=muted)
            y += 39
        draw.line((85, 1300, 995, 1300), fill=muted, width=1)
        path = folder / f"slide-{index + 1:02}.jpg"
        canvas.save(path, quality=93, optimize=True)
        with Image.open(path) as check:
            if check.size != (1080, 1350) or path.stat().st_size > 8 * 1024 * 1024:
                raise Blocked(
                    "invalid_asset", "Rendered media does not meet the configured image constraints."
                )
        quality["assets"].append(
            {
                "file": path.name,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "bytes": path.stat().st_size,
                "alt": f"{slide['title']}. {slide['body']}",
            }
        )
    carousel.asset_dir, carousel.quality = str(folder), quality
    carousel.status = "quality_passed"
    carousel.save()
    (folder / "caption.txt").write_text(carousel.caption)
    (folder / "sources.json").write_text(
        json.dumps(
            list(
                SourceClaim.objects.filter(pk__in=carousel.claim_ids).values(
                    "claim",
                    "qualification",
                    "source_url",
                    "publisher",
                    "title",
                    "source_date",
                    "retrieved_at",
                    "source_sha256",
                    "verification_method",
                )
            ),
            default=str,
            indent=2,
        )
    )
    (folder / "manifest.json").write_text(
        json.dumps(
            {
                "id": str(carousel.pk),
                "status": carousel.status,
                "destination": carousel.destination,
                "campaign": carousel.campaign_id,
                "quality": quality,
            },
            indent=2,
        )
    )
    (folder / "ready-to-publish.zip").unlink(missing_ok=True)
    archive = shutil.make_archive(str(folder.parent / f"{carousel.pk}-package"), "zip", folder)
    shutil.move(archive, folder / "ready-to-publish.zip")
    return carousel


def create_carousel():
    ensure_running("marketing")
    # One content experiment at a time; repeated triggers reuse its actual persisted artifact.
    existing = Carousel.objects.exclude(status__in=["published", "archived", "failed"]).first()
    if existing:
        return existing
    claims = research()
    if any(c.verified_at < timezone.now() - timedelta(days=7) for c in claims):
        raise Blocked("stale_sources", "Refresh sources before producing a new carousel.")
    destination = settings.MARKETING_DESTINATION
    parsed = urlparse(destination)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise Blocked(
            "destination_missing", "Configure the real product destination before rendering the CTA."
        )
    campaign = f"sharing-{timezone.now():%Y%m%d}"
    campaign_url = (
        destination
        + ("&" if "?" in destination else "?")
        + urlencode({"utm_source": "instagram", "utm_medium": "carousel", "utm_campaign": campaign})
    )
    carousel = Carousel.objects.create(
        topic="Before you hit send",
        claim_ids=[str(c.pk) for c in claims],
        campaign_id=campaign,
        destination=campaign_url,
        status="sources_verified",
        data_mode="manual",
        slides=[
            {
                "eyebrow": "FILE SHARING, EXPLAINED",
                "title": "Before you hit send.",
                "body": "Attachment or link? A few useful details can change how you share your next document.",
                "source": "A practical guide · Sources on the next slides",
            },
            {
                "eyebrow": "01 / KNOW YOUR LIMIT",
                "title": "25 MB in personal Gmail.",
                "body": "That is the attachment limit for personal accounts. Work and school limits are set by the Workspace administrator.",
                "source": "Source: Google · Gmail attachment help",
                "claim_key": "gmail-personal-limit",
            },
            {
                "eyebrow": "02 / WHEN IT IS TOO LARGE",
                "title": "Gmail switches to a link.",
                "body": "When total attachments exceed the applicable limit, Gmail adds a Google Drive link. Check that the recipient has access.",
                "source": "Source: Google · Gmail attachment help",
                "claim_key": "gmail-drive-fallback",
            },
            {
                "eyebrow": "03 / CHECK THE ACCESS PATH",
                "title": "A link is one route in.",
                "body": "Dropbox link restrictions apply to that link. People with existing direct access keep their permissions. Manage direct access separately.",
                "source": "Source: Dropbox · Shared link permissions (paid-plan options)",
                "claim_key": "dropbox-access-path",
            },
            {
                "eyebrow": "A HABIT WORTH KEEPING",
                "title": "Check the version and the person.",
                "body": "Choose the exact document. Confirm the recipient address. Decide when access should end. Treat downloaded copies as permanent.",
                "source": "Practical guidance from Fyde · Not a measured statistic",
            },
            {
                "eyebrow": "TRY FYDE",
                "title": "The right file. The right person.",
                "body": "Try Fyde free. Add a file and a verified contact, then ask for a send. Open Fyde at the address below.",
                "source": f"{parsed.netloc} · Web app · 10 free sends/month; resource limits apply",
            },
        ],
    )
    references = "\n".join(f"{c.publisher}: {c.source_url}\n{c.qualification}" for c in claims)
    carousel.caption = f"Before your next file send: know the attachment limit and check who can open the link.\n\nSources checked {timezone.now():%Y-%m-%d} (UTC):\n{references}\n\nTry Fyde free: {campaign_url}\nGoogle and Dropbox are referenced for their documented behavior; no affiliation is implied."
    carousel.save(update_fields=["caption"])
    render_slides(carousel)
    publication, _ = Publication.objects.get_or_create(
        carousel=carousel, defaults={"failure_code": "instagram_not_authorized"}
    )
    carousel.blocker = "Publication needs an authorized professional Instagram account, approved API permissions, public HTTPS media, and a reachable public product destination."
    carousel.save(update_fields=["blocker"])
    from .instagram import ready

    if ready():
        from .feedback import enqueue

        enqueue("publish", f"publish/{carousel.pk}", {"carousel_id": str(carousel.pk)}, "live")
    emit(
        "content.verified",
        f"carousel/{carousel.pk}",
        mode="manual",
        actor="research_renderer",
        payload={"carousel_id": str(carousel.pk), "claims": len(claims)},
    )
    return carousel
