"""Passage indexing and owner-scoped hybrid retrieval. Search cannot authorize a send."""

import math
import re
import uuid
from datetime import timedelta
from functools import reduce
from operator import or_

from django.conf import settings
from django.contrib.postgres.search import SearchQuery, SearchRank, SearchVector
from django.db import connection, transaction
from django.db.models import F, Q
from django.utils import timezone
from pgvector.django import CosineDistance

from inference.spec import FINGERPRINT, MAX_BATCH
from . import embeddings
from .commands import normalize, visible_versions
from .models import Document, FileVersion, SearchIndex, SearchSegment

INDEX_FINGERPRINT = FINGERPRINT + ":chunks1400-overlap200-v1"
STOP_WORDS = {
    "find",
    "my",
    "the",
    "file",
    "files",
    "document",
    "documents",
    "a",
    "for",
    "about",
    "latest",
    "from",
    "to",
    "with",
    "in",
    "on",
    "at",
    "of",
    "and",
    "an",
    "me",
    "is",
    "that",
    "where",
    "which",
}


def terms_for(query):
    return [word for word in re.findall(r"[\w.-]+", normalize(query)) if word not in STOP_WORDS][:20]


def chunks(version):
    text = version.extracted_text
    pages = version.page_offsets or [{"page": None, "start": 0, "end": len(text)}]
    ordinal = 0
    for page in pages:
        start, end = page["start"], min(page["end"], len(text))
        while start < end:
            stop = min(start + 1400, end)
            if stop < end:
                boundary = max(text.rfind("\n", start + 900, stop), text.rfind(" ", start + 900, stop))
                if boundary > start:
                    stop = boundary
            passage = text[start:stop]
            if passage.strip():
                yield SearchSegment(
                    version=version,
                    ordinal=ordinal,
                    page=page["page"],
                    start=start,
                    end=stop,
                    text=passage,
                    normalized_text=normalize(version.original_name + " " + passage),
                    fingerprint=INDEX_FINGERPRINT,
                )
                ordinal += 1
            if stop >= end:
                break
            start = stop - 200


def enqueue_index(version, *, retry=False):
    with transaction.atomic():
        # Serializes against deletion; a late extractor cannot recreate a deleted index.
        document = Document.objects.select_for_update().get(pk=version.document_id)
        if document.deleted_at or not FileVersion.objects.filter(pk=version.pk, state="ready").exists():
            return
        job, created = SearchIndex.objects.get_or_create(
            version=version,
            defaults={"fingerprint": INDEX_FINGERPRINT},
        )
        if not created and (job.fingerprint != INDEX_FINGERPRINT or (retry and job.state == "blocked")):
            job.fingerprint, job.state, job.attempts = INDEX_FINGERPRINT, "pending", 0
            job.available_at, job.lease_until, job.lease_token, job.error_code = (
                timezone.now(),
                None,
                None,
                "",
            )
            job.save()


def backfill(*, retry=False):
    candidates = visible_versions_for_index()
    if not retry:
        candidates = candidates.filter(
            Q(search_index__isnull=True) | ~Q(search_index__fingerprint=INDEX_FINGERPRINT)
        )
    count = 0
    for version in candidates.iterator(chunk_size=100):
        enqueue_index(version, retry=retry)
        count += 1
    return count


def visible_versions_for_index():
    return FileVersion.objects.filter(
        state="ready",
        document__deleted_at=None,
        document__current_version_id=F("pk"),
    )


def process_index():
    if not settings.SEARCH_EMBEDDING_URL:
        return False
    now = timezone.now()
    with transaction.atomic():
        eligible = (
            SearchIndex.objects.filter(
                fingerprint=INDEX_FINGERPRINT,
                version__state="ready",
                version__document__deleted_at=None,
            )
            .filter(
                Q(state__in=["pending", "retry"], available_at__lte=now)
                | Q(state="running", lease_until__lte=now)
            )
            .order_by("available_at", "pk")
        )
        job = eligible.select_for_update(skip_locked=True, of=("self",)).first()
        if not job:
            return False
        token = uuid.uuid4()
        job.state, job.lease_token, job.lease_until = "running", token, now + timedelta(minutes=3)
        job.attempts += 1
        job.save(update_fields=["state", "lease_token", "lease_until", "attempts"])
    version = FileVersion.objects.select_related("document").get(pk=job.version_id)
    segments = list(chunks(version))
    try:
        for offset in range(0, len(segments), MAX_BATCH):
            if not SearchIndex.objects.filter(
                pk=job.pk,
                lease_token=token,
                version__document__deleted_at=None,
            ).exists():
                return True
            batch = segments[offset : offset + MAX_BATCH]
            vectors = embeddings.embed(
                [f"title: {version.original_name} | text: {s.text}" for s in batch],
                task="document",
                timeout=120,
            )
            for segment, vector in zip(batch, vectors, strict=True):
                segment.embedding = vector
            if not SearchIndex.objects.filter(pk=job.pk, lease_token=token).update(
                lease_until=timezone.now() + timedelta(minutes=3),
            ):
                return True
        with transaction.atomic():
            document = Document.objects.select_for_update().get(pk=version.document_id)
            current = SearchIndex.objects.select_for_update().filter(pk=job.pk, lease_token=token).first()
            if (
                not current
                or document.deleted_at
                or not FileVersion.objects.filter(
                    pk=version.pk,
                    state="ready",
                    sha256=version.sha256,
                ).exists()
            ):
                return True
            SearchSegment.objects.filter(version=version).delete()
            SearchSegment.objects.bulk_create(segments)
            if connection.vendor == "postgresql":
                SearchSegment.objects.filter(version=version).update(
                    search_vector=SearchVector("normalized_text", config="simple"),
                )
            current.state, current.lease_token, current.lease_until, current.error_code = (
                "indexed",
                None,
                None,
                "",
            )
            current.save(update_fields=["state", "lease_token", "lease_until", "error_code"])
    except embeddings.EmbeddingUnavailable as error:
        SearchIndex.objects.filter(pk=job.pk, lease_token=token).update(
            state="blocked" if job.attempts >= 5 else "retry",
            error_code=error.code,
            available_at=timezone.now() + timedelta(seconds=min(30 * 2**job.attempts, 1800)),
            lease_until=None,
            lease_token=None,
        )
    return True


def _lexical(versions, segments, terms):
    if not terms:
        return [], set()
    # Exact metadata and literal contents remain available before inference finishes or while it is down.
    metadata, literal = Q(), Q()
    for term in terms:
        fields = [
            "document__title",
            "original_name",
            "document__tags",
            "document__document_type",
            "document__matter__name",
        ]
        label = reduce(or_, (Q(**{field + "__icontains": term}) for field in fields))
        metadata &= label
        literal &= (
            label
            | Q(extracted_text__icontains=term)
            | Q(
                pk__in=segments.filter(normalized_text__contains=term).values("version_id"),
            )
        )
    exact = list(versions.filter(metadata).order_by("-created_at", "pk").values_list("pk", flat=True)[:30])
    hits = [(pk, None) for pk in exact]
    seen = set(exact)
    if connection.vendor == "postgresql":
        query = reduce(or_, (SearchQuery(term, config="simple") for term in terms))
        ranked = (
            segments.filter(search_vector=query)
            .annotate(rank=SearchRank("search_vector", query))
            .order_by("-rank", "pk")
        )
    else:
        match = reduce(or_, (Q(normalized_text__contains=term) for term in terms))
        ranked = segments.filter(match).order_by("version_id", "ordinal")
    for segment in ranked[:300]:
        if sum(term in segment.normalized_text for term in terms) < max(1, len(terms) / 2):
            continue
        if segment.version_id not in seen:
            hits.append((segment.version_id, segment))
            seen.add(segment.version_id)
        if len(hits) >= 60:
            break
    for pk in versions.filter(literal).order_by("-created_at", "pk").values_list("pk", flat=True)[:60]:
        if pk not in seen:
            hits.append((pk, None))
            seen.add(pk)
    return hits[:60], set(exact)


def _semantic(segments, query_vector):
    if connection.vendor == "postgresql":
        return list(
            segments.annotate(distance=CosineDistance("embedding", query_vector))
            .filter(
                distance__lte=1 - settings.SEARCH_MIN_SIMILARITY,
            )
            .order_by("distance", "pk")[:100]
        )
    # SQLite is the local development fallback; production computes distances in Postgres.
    scored = []
    for segment in segments.iterator(chunk_size=100):
        similarity = sum(float(a) * b for a, b in zip(segment.embedding, query_vector, strict=True))
        if math.isfinite(similarity) and similarity >= settings.SEARCH_MIN_SIMILARITY:
            scored.append((similarity, segment))
    return [s for _, s in sorted(scored, key=lambda pair: -pair[0])[:100]]


def _excerpt(text, terms):
    location = next((normalize(text).find(term) for term in terms if term in normalize(text)), 0)
    start = max(0, location - 90)
    return (
        ("…" if start else "")
        + re.sub(r"\s+", " ", text[start : start + 320]).strip()
        + ("…" if start + 320 < len(text) else "")
    )


def search(owner, query):
    from .chat import file_card

    versions = visible_versions(owner).filter(state="ready")
    segments = SearchSegment.objects.filter(version__in=versions, fingerprint=INDEX_FINGERPRINT)
    if not query.strip():
        return {
            "files": [
                file_card(v)
                for v in versions.select_related("document__matter").order_by("-created_at", "pk")[:30]
            ],
            "mode": "keyword",
            "semantic_status": "idle",
        }
    terms = terms_for(query)
    words, exact = _lexical(versions, segments, terms)
    semantic, status = [], "disabled"
    if settings.SEARCH_EMBEDDING_URL:
        status = "indexing" if versions.exists() else "empty"
        if SearchIndex.objects.filter(version__in=versions, state="blocked").exists():
            status = "blocked"
        if segments.exists():
            try:
                semantic = _semantic(segments, embeddings.embed([query], task="query")[0])
                status = "ready"
            except embeddings.EmbeddingUnavailable:
                status = "unavailable"
    scores, places = {}, {}
    for rank, (pk, segment) in enumerate(words, 1):
        scores[pk] = 1 / (60 + rank) + (0.035 if pk in exact else 0)
        places[pk] = (segment, "keyword")
    seen = set()
    for segment in semantic:
        pk = segment.version_id
        if pk in seen:
            continue
        seen.add(pk)
        scores[pk] = scores.get(pk, 0) + 1 / (60 + len(seen))
        if pk not in exact:
            places[pk] = (segment, "semantic")
    ordered = sorted(scores, key=lambda pk: (-scores[pk], str(pk)))[:30]
    # Hydrate only through the current permission scope after the remote call, before reading excerpts.
    permitted = {v.pk: v for v in versions.filter(pk__in=ordered).select_related("document__matter")}
    files = []
    for pk in ordered:
        version = permitted.get(pk)
        if not version:
            continue
        segment, kind = places[pk]
        files.append(
            {
                **file_card(version),
                "match": {
                    "kind": kind,
                    "excerpt": _excerpt(segment.text if segment else version.extracted_text, terms),
                    "page": segment.page if segment else None,
                    "start": segment.start if segment else 0,
                    "end": segment.end if segment else len(version.extracted_text),
                },
            }
        )
    return {"files": files, "mode": "hybrid" if status == "ready" else "keyword", "semantic_status": status}
