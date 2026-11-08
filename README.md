# Fyde

Fyde is a chat-first file-sharing app for web, iOS and Android. It finds and shares files with known contacts. A trusted backend binds each send to a verified recipient, an exact immutable version, a permission, an operation ID, and an expiry. Company workflows use a separate database and sanitized inputs.

The customer app uses a TypeScript API on Neon Functions, with the Expo web frontend hosted by Cloudflare Workers Static Assets. Neon also provides Postgres, private object storage and Managed Better Auth. See [Cloudflare and Neon hosting](docs/cloudflare-neon.md) for configuration, checks and development delivery.

The Django application remains available as a local fixture app and for the separate company tools. Live email/SMS file notifications, billing, Naïve, Reddit and Instagram still need the accounts and controls listed in [product.md](product.md).

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

For the Neon-backed runtime, follow [the Neon setup](docs/neon.md). It connects separate customer and company Postgres projects, private object storage, and managed email/password plus Google authentication. Local fixture mode remains available for development and tests.

## Try the complete workflow

1. Create a sender account and a separate recipient account. Verify each account email using its local test outbox.
2. Upload `artifacts/synthetic-resume.txt` as “My résumé.” The customer worker validates and indexes it.
3. Add John using the recipient account’s verified email. No message is sent merely for adding this contact.
4. Type `Send my résumé to John`. Fyde is the default channel. The receipt records `available_in_app`, the exact version and one consumed send.
5. Sign in as John and open **Received**. Download and compare the original bytes. A forwarded transfer link cannot unlock the file for another account.
6. Choose **Email** or say `Send my résumé to John by email` to queue a recipient-bound download link. Unknown recipients must first verify the contact endpoint. The guest verifies that endpoint again before downloading inside Fyde. A matching verified account also receives the file in **Received**.
7. Optional **Phone (SMS)** sends the same kind of link to a verified phone. SMS is disconnected by default; set `SMS_ADAPTER=local` for a labeled test outbox. Link and verify the recipient’s own phone in Settings to receive phone-addressed files in their account. Live SMS needs the separate setup in the runbook.
8. Revoke a transfer to block future downloads. Existing downloads cannot be recalled. Standing permissions also bind the exact channel, endpoint, purpose, expiry and request limit. The contact’s request link supports matching account sign-in or email/phone verification.

The channel selector applies to each send; Settings saves a default. Explicit command suffixes override the selector. A successful app delivery consumes one unit immediately, with no email/SMS provider dependency. Optional notification failure does not reverse a file already received. Repeated downloads only debit bandwidth. Receiving is free and uses the original owner’s version and permissions; it does not copy the document into the recipient’s owned files.

New accounts start with file import, contact relationships and permission setup. The primary screen is private chat, shared across web and mobile. Owners can authorize a verified recipient to request any supported document type within one assigned case, with explicit future-file/version and sensitivity choices. A recipient agent can use one scoped credential to request and download permitted files while the owner is offline. See [mobile setup and the agent protocol](docs/mobile-and-agents.md).

The command resolver currently supports bounded English `find`, `send`, `share`, `email` and case `request` commands. It normalizes résumé/resume and handles matching contact aliases. Ambiguity requires a choice. Pronouns require explicitly saved, 15-minute app context. The dedicated search bar combines keywords with EmbeddingGemma 2 passage embeddings when a private inference service is configured. Extracted passages and queries then go to that service; embeddings stay in the customer database. Search does not authorize sharing. See [semantic search setup](docs/semantic-search.md). General semantic conversation, voice, local folders, and wearable integrations remain future work. The native client source is in `mobile/client`; its browser preview is a separate React Native web surface. iOS/Android distribution, physical-device QA and live provider integrations have separate readiness states in the tracker.

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

The [production website and mobile API](docs/production.md) use `https://fyde.mehmetuzgoren.workers.dev`. Native preview and release profiles select that origin. Production data and credentials are separate from development.

The customer hosting path is [Cloudflare plus Neon Functions](docs/cloudflare-neon.md). Its development deployment workflow follows a successful verified `dev` push and checks the hosted Git SHA. Production promotion requires a separate release request.

The legacy Docker image runs the Django fixture/company app as an unprivileged user. Its container host and SSH scripts are retained for that separate runtime; the customer deployment does not use them. See [operations](docs/operations.md) and [the implementation register](product.md) for the remaining provider dependencies.
