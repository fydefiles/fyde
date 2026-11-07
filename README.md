# Fyde

Fyde finds and shares files with known contacts. A trusted backend binds each send to a verified recipient, an exact immutable version, a permission, an operation ID, and an expiry. Company workflows use a separate database and sanitized inputs.

The repository was empty on November 7, 2026. This implementation uses Django 5.2 LTS, PostgreSQL for production and SQLite for local development, private filesystem storage, and durable database jobs. The application is usable locally. Live email, billing, Naïve, Reddit, Instagram, and hosted deployment require the accounts and controls listed in [product.md](product.md).

## Run locally

Install Python 3.12+ and [uv](https://docs.astral.sh/uv/). Then run:

```sh
uv sync --frozen
uv run python manage.py migrate
uv run python manage.py migrate --database company
uv run python manage.py bootstrap --demo
uv run python dev.py
```

Open http://127.0.0.1:8000. Create your own account or use the local fixture operator whose generated credentials are in the ignored `var/demo-login.txt`. The demo account works only with the local email adapter. It contains no real customer data. `dev.py` starts the web service, customer delivery worker, trusted bridge, and company worker and stops them together with Ctrl-C.

Defaults need no external credentials. An optional `.env` can copy `.env.example`. Local messages appear in **Open outbox**, never a real mailbox. The outbox is disabled outside development. A real provider must produce a real acceptance ID before the product claims provider acceptance.

## Try the complete workflow

1. Sign in. Open the sender-verification message in the local outbox and enter its six-digit code.
2. Upload `artifacts/synthetic-resume.txt` with a title such as “My résumé.” The customer worker validates and indexes it.
3. Add John with a synthetic email such as `john@example.test`. Open the contact-verification message and enter its code.
4. Type `Send my résumé to John`. Inspect the receipt and the exact version, destination, quota state, and fixture identifier.
5. Open the transfer link from the outbox. It reveals no document until you request and complete separate recipient verification. Download and compare the original bytes.
6. Revoke the transfer. Previously downloaded copies remain outside Fyde's control; future downloads fail.
7. For automatic requests, create a standing permission for a verified contact, exact version, purpose, expiry, and request limit. Use the contact's request link, verify that email, and request permitted versions. A different purpose, version, or endpoint is unavailable.

The command resolver currently supports bounded English `find`, `send`, `share`, and `email` commands. It normalizes résumé/resume and handles matching contact aliases. Ambiguity requires a choice. Pronouns require explicitly saved, 15-minute app context. No external language model receives customer documents. General semantic conversation, voice, local folders, and wearable integrations remain future work.

## Company operation

Attendees can leave voluntary public feedback or private support in the app. Public feedback is redacted and enters durable triage. Private support details remain in the customer database. The bridge exports only opted-in public text and aggregate usage; it returns deduplicated notifications through customer-owned records.

Eligible automatic changes are limited to **plain text in one existing section of `content/help.json`**. The Naïve builder receives that file and the sanitized request, with all tools denied and a per-session budget. Trusted code validates the result, creates an isolated Git worktree, and runs the fixed application suite in an immutable, network-disabled Docker image. A separate controller can open a PR into protected `dev`, wait for required checks, merge without bypass privileges, and require a matching hosted smoke result before notifying the requester. Authentication, file release, billing, dependencies, CI and authority controls are protected. Default activation is off.

Broader autonomous code editing, a genuine attendee release, and production operation are not claimed. [Operations](docs/operations.md) describes the boundaries and remaining release setup.

The marketing worker fetches current primary-source evidence from a curated Google/Dropbox catalog, verifies its support anchors, renders six deterministic 1080×1350 JPEG slides, checks layout, and exports captions, sources, hashes and a ZIP. The last slide links to the actual configured web app. Approved account credentials and public HTTPS media are required for publication. Uncertain publication outcomes stay reconcilable. Missing performance remains unknown. This first topic is a reusable source-backed workflow, not an open-ended research agent.

Operators can inspect `/company/`, job traces, source claims, rendered assets, founder actions, incidents, observed costs and heartbeat times. Only staff accounts can access company controls. A global pause stops company jobs; customer sharing has its own global and per-contact pauses.

## Verification

```sh
uv run python manage.py check
uv run python manage.py makemigrations --check --dry-run
uv run ruff check .
uv run python manage.py test tests --noinput
```

The database-backed journeys protect disclosure, verification, permissions, metering, provider uncertainty, billing events, untrusted feedback, redaction, release scope, budgets and pause behavior. They use synthetic data and mocked provider responses. They do not prove live delivery, payments or publications. The concurrent last-quota-unit check runs on PostgreSQL; SQLite skips that one check. GitHub CI uses PostgreSQL and requires it.

## Deployment

Build with `docker build --build-arg RELEASE_SHA=$(git rev-parse HEAD) -t fyde:local .`. The image runs as an unprivileged user. A protected development deployment workflow is supplied but **disabled until hosting is configured**. No production service or background cloud worker currently exists. Use [the deployment runbook](docs/operations.md) and [the living implementation register](product.md) before activation.
