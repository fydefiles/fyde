"""Customer-only client for the private EmbeddingGemma 2 service."""

import math
from functools import lru_cache

import httpx
from django.conf import settings
from google.auth.exceptions import GoogleAuthError

from inference.spec import DIMENSIONS, FINGERPRINT, MAX_BATCH, MAX_TEXT_CHARS


class EmbeddingUnavailable(Exception):
    def __init__(self, code="embedding_unavailable"):
        self.code = code
        super().__init__(code)


@lru_cache(maxsize=4)
def _credentials(audience, principal):
    import google.auth
    from google.auth import impersonated_credentials
    from google.oauth2 import id_token
    from google.auth.transport.requests import Request

    if principal:
        source, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        target = impersonated_credentials.Credentials(
            source_credentials=source,
            target_principal=principal,
            target_scopes=["https://www.googleapis.com/auth/cloud-platform"],
            lifetime=3600,
        )
        return impersonated_credentials.IDTokenCredentials(target, target_audience=audience)
    return id_token.fetch_id_token_credentials(audience, request=Request())


def embed(inputs, *, task, timeout=None):
    if not settings.SEARCH_EMBEDDING_URL:
        raise EmbeddingUnavailable("embedding_disabled")
    if task not in {"query", "document"} or not 1 <= len(inputs) <= MAX_BATCH:
        raise ValueError("Invalid embedding batch")
    if any(not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS for text in inputs):
        raise ValueError("Invalid embedding input")
    try:
        headers = {}
        if settings.SEARCH_EMBEDDING_AUTH == "google":
            from google.auth.transport.requests import Request

            credentials = _credentials(settings.SEARCH_EMBEDDING_URL, settings.SEARCH_GOOGLE_SERVICE_ACCOUNT)
            if not credentials.valid:
                credentials.refresh(Request())
            headers["Authorization"] = f"Bearer {credentials.token}"
        response = httpx.post(
            settings.SEARCH_EMBEDDING_URL + "/embed",
            json={"task": task, "inputs": inputs},
            headers=headers,
            timeout=timeout or settings.SEARCH_EMBEDDING_TIMEOUT,
            follow_redirects=False,
        )
        response.raise_for_status()
        data = response.json()
        if data.get("fingerprint") != FINGERPRINT:
            raise EmbeddingUnavailable("embedding_model_mismatch")
        rows = data["embeddings"]
        if not isinstance(rows, list) or len(rows) != len(inputs):
            raise ValueError("Invalid embedding count")
        vectors = []
        for row in rows:
            if not isinstance(row, list) or len(row) != DIMENSIONS:
                raise ValueError("Invalid embedding dimensions")
            if any(
                isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in row
            ):
                raise ValueError("Invalid embedding values")
            norm = math.sqrt(sum(v * v for v in row))
            if not math.isfinite(norm) or norm <= 0:
                raise ValueError("Invalid embedding magnitude")
            vectors.append([v / norm for v in row])
        return vectors
    except (httpx.HTTPError, GoogleAuthError, ValueError, KeyError, TypeError, AttributeError):
        # Provider response bodies and document contents never enter operational logs.
        raise EmbeddingUnavailable() from None
