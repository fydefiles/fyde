# Imported-file semantic search

The dedicated search bar searches the authenticated owner's current, validated files. It combines exact metadata and keyword matches with semantic passage retrieval. It returns one result per file, a plain-text excerpt and, for newly extracted PDFs, a page number. It supports the existing TXT, Markdown, CSV, text-bearing PDF and DOCX imports. Images, scanned documents, audio and video still need their own import and validation paths. Existing PDFs whose text was extracted before page offsets were stored can be searched, but their excerpts have no page locator.

## Index and permissions

`SearchIndex` is a durable job for one immutable file version. A separate `run_search_indexer` worker takes leases, batches embeddings, retries temporary failures with backoff and publishes segments atomically. It discovers existing current versions as well as new uploads. After five failed attempts a job stays blocked until an operator retries it. Extracting or embedding a document never changes its sharing permissions.

`SearchSegment` stores the passage, original text offsets, optional PDF page, normalized keyword text, a 768-dimensional vector and its model/index fingerprint. PostgreSQL uses the `vector` extension for exact cosine-distance retrieval within the owner's corpus, and a GIN index for full-text retrieval. SQLite provides a local development fallback. This version uses exact vector search; a shared approximate index would need separate tenant-filtered recall measurements.

Retrieval scopes both paths to the owner before ranking and rechecks current ownership, version and deletion state before returning excerpts. Recipient-agent tokens cannot use this endpoint. Document deletion removes passages, vectors and jobs in the same transaction. An indexing worker finishing after deletion cannot recreate them. Chat's existing file-send resolver remains separate from semantic retrieval.

## Inference service

`inference/` contains a CPU-only Cloud Run service. It pins `google/embeddinggemma-2` to revision `f9972ac22e696a105c482202646979e33e4b5a1e`, loads only its text backbone and uses the published query/document prefixes, mean pooling and L2 normalization. It runs FP32 inference and rejects malformed requests. The image contains the model weights, so inference needs no model download or Hugging Face credential at runtime. Health reports the model fingerprint and application revision. A mismatched model, dimension, invalid value or zero vector cannot enter the index.

The deployment starts with 2 vCPUs, 4 GiB memory, one concurrent request, zero minimum instances and at most one instance. Cloud Run IAM authenticates callers. The inference runtime service account needs no customer database, storage or project permissions. Requests carry extracted passages or queries in POST bodies; application logs exclude their contents. The service does not mount customer files or retain customer passages. CPU service, build and registry usage remain subject to the billing account's actual credits and terms; instance limits are not a spending cap.

The approved account is `mehmet@edseyir.com`. The isolated project is `fyde-search-edseyir`, in the `edseyir.com` organization. Check its billing account's credit balance and expiry before deploying; do not upgrade a trial or switch billing accounts as part of a deployment.

After billing, required APIs, the private `fyde-images` Artifact Registry repository and `fyde-embedding-runtime` service account are configured, deploy the committed revision:

The Cloud Build identity needs read access to the project's source-staging bucket, writer access to this Artifact Registry repository and `roles/logging.logWriter`. The build uses Cloud Logging rather than a separate log bucket. These build permissions belong to the build identity, not the inference runtime.

```sh
GOOGLE_CLOUD_PROJECT=fyde-search-edseyir \
GCLOUD_ACCOUNT=mehmet@edseyir.com \
bash ops/deploy-embedding.sh
```

Grant `roles/run.invoker` on this service to a dedicated customer-backend caller. Keep anonymous invocation disabled. Attach that identity to a Google Cloud backend, or allow the approved local user to impersonate that narrowly scoped service account. The runtime and caller identities are separate.

## Customer backend configuration

Apply migration `0007_semantic_search` with the migration-owner connection, which must be allowed to create the `vector` extension. Grant the customer runtime role access to the new tables. Company workers receive neither the inference configuration nor customer database credentials.

Set these variables in the customer web and search-worker environments:

```sh
SEARCH_EMBEDDING_URL=https://YOUR_PRIVATE_SERVICE.run.app
SEARCH_EMBEDDING_AUTH=google
SEARCH_MIN_SIMILARITY=0.60
SEARCH_EMBEDDING_TIMEOUT=30
```

On Google Cloud, the attached service identity supplies an ID token through the metadata service. For local development, sign in with Application Default Credentials and set `SEARCH_GOOGLE_SERVICE_ACCOUNT` to the dedicated Run invoker identity that those credentials may impersonate. Do not use a downloadable service-account key.

Run the customer indexing worker separately from file extraction and transactional delivery:

```sh
uv run python manage.py run_search_indexer
```

`--once` processes currently available jobs and exits; `--retry-blocked` resets blocked jobs. Leave `SEARCH_EMBEDDING_URL` empty to disable inference. A loopback HTTP service with `SEARCH_EMBEDDING_AUTH=none` is permitted only in development. An unavailable service falls back to literal search and reports that state in the response and mobile UI. Cold starts can therefore temporarily return keyword results. The default similarity threshold is an initial retrieval setting, not calibrated confidence; measure it on representative permitted files before broad use.

The API remains `POST /api/v1/files/search/` with a `query` of up to 180 characters. Each existing file card can include `match.excerpt`, `match.page`, `match.start`, `match.end` and `match.kind`. The response includes `mode` and `semantic_status`. Locators identify a passage in that exact version; this change does not add a PDF viewer or media timestamp playback.

## Verification

Integration journeys cover paraphrases, exact identifiers during inference outages, owner and current-version isolation, PDF page extraction, deduplication, deletion during indexing and retrieval, invalid vectors, expired leases and libraries beyond the old 1,000-file cutoff. Synthetic provider responses establish application behavior. A separate real-model smoke establishes model loading and paraphrase retrieval; cloud authentication, deployed identity and credit usage need actual Google Cloud evidence.
