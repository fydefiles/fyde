# Operator runbook, version 2026-11-07

This runbook describes the implemented controls and the setup needed for live operation. No hosting, email/SMS sender, paid subscription, social account, or Naïve session has been activated by this build.

## Roles and credentials

| Process | Allowed data and credentials | Excluded |
| --- | --- | --- |
| Web / trusted customer backend | Customer database, private files, session key; company database for staff views and controlled intake | Builder/deployment credentials |
| Customer delivery worker | Customer database, private files, scoped email/SMS keys and separate configured budgets | Naïve, Instagram, GitHub release keys |
| Trusted bridge | Scoped customer feedback/notification/aggregate access and company database | General agent execution, file mounts, deployment tools |
| Company coordinator | Company database, sanitized help content, scoped Naïve sessions key and budget | Customer database credentials, customer file mounts, mailbox and billing keys |
| Remote content builder | One public help JSON file and sanitized opt-in feedback; output schema only | External tools, identity grants, production data, secrets, GitHub access |
| Independent verifier | Trusted baseline image, candidate help JSON mounted read-only, synthetic tests, empty temporary databases | Network, customer storage, host home, secrets, Docker socket |
| Release controller | Verified content artifact, repository-scoped GitHub App token, development deployment evidence | Customer database, storage, pricing changes, own control modifications, production merge authority |
| Marketing publisher | Company content records, approved Page/Instagram token, generated public media, current primary sources | Customer documents, customer DB, paid ads, mass messaging |

The coordinator is trusted orchestration code, not the untrusted model. Run the untrusted builder remotely with every tool denied. Run `DJANGO_SETTINGS_MODULE=fyde.company_settings` for company-only workers. That settings module disables `.env` loading, replaces the customer database with an empty in-memory database, and disables transactional email and billing. Supply only the role's allowlisted environment. Set `COMPANY_DATA_MODE=live` only on the real deployed company worker; local operations default to fixture mode. Production database ACLs and volume mounts must enforce the same boundary; sharing a database admin password defeats it.

`compose.production.yml` is an activation template. It separates private files from marketing assets and omits all customer volumes from company workers. It does not provision databases, secrets, DNS, TLS, scanners, backups or a release host. The generic company container deliberately has no Docker socket or deployment token. Isolated Git building and verifier execution require a separate trusted controller host with the committed source checkout, Git, and a container engine. Do not mount the host Docker socket into a model-controlled environment.

## Live email

1. Verify a sending domain with Resend. Store the scoped key in the host secret store.
2. Set `EMAIL_ADAPTER=resend`, `EMAIL_FROM`, `RESEND_API_KEY`, the public HTTPS `SITE_URL`, positive `EMAIL_UNIT_COST_USD` and `EMAIL_DAILY_BUDGET_USD`, and `EXTERNAL_EMAIL_DAILY_LIMIT`.
3. Supervise `run_delivery`. It persists email intent before sending, reserves the configured estimated spend once, and uses a stable Resend idempotency key. Unknown outcomes retain quota and can retry the same immutable payload at most three times inside 23 hours. Beyond that, operator/provider reconciliation is required. Resend documents a 24-hour provider idempotency window.
4. Create a fresh live account; fixture identities and local verification cannot authorize live sends. Complete real sender/contact verification, a send and recipient download using a consent-safe sample. Preserve the provider ID and receipt; do not mark M1 live-verified before this.
5. Use `manage.py reconcile_delivery [transfer_id]` to retrieve provider status. Provider-reported terminal failures reverse usage once only if the file was never available in a verified inbox or accessed. Do not invent delivery/read evidence.

Config-blocked jobs remain visibly blocked. Cancel an unsent transfer to release its unused quota, resolve configuration, and create a new operation. Revoking an uncertain send keeps its reservation until the provider outcome is reconciled; it does not authorize a resend.

## App and optional phone delivery

Fyde is the default channel. It matches an active account in the same live/fixture mode by verified email or linked, verified E.164 phone. If both endpoints identify different accounts, native delivery stops for correction. An unregistered contact needs email or SMS delivery instead. Received records bind the original transfer to one account; later endpoint changes cannot reassign them. Every download rechecks identity, permissions, pauses, expiry, revocation and original-file hash. No external provider is called for native delivery.

The [Twilio Messages API](https://www.twilio.com/docs/messaging/api/message-resource) adapter sends and reconciles SMS messages. Phone means an SMS link to a download page in Fyde, not a phone attachment or iMessage. New phone identities require a verified account email and an SMS challenge. Contact-phone verification alone never links the number to a receiving account. Email and phone proofs are distinct and cannot authorize each other’s permissions.

1. Use `SMS_ADAPTER=local` only for development fixtures. The default is `disabled`; the app labels missing connection status and never claims an SMS was sent.
2. For live SMS, authorize a Twilio account and sender appropriate to the destinations, then place `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and an E.164 `SMS_FROM` in the customer worker’s secret store. Set `SMS_ADAPTER=twilio`, HTTPS `SITE_URL`, positive `SMS_UNIT_COST_USD` (per segment including carrier charges), `SMS_DAILY_BUDGET_USD`, and `SMS_DAILY_LIMIT`. Country/sender registration and messaging permissions require operator completion. Never give these credentials to business agents.
3. The worker reserves a conservative Unicode segment estimate and one message count before the provider call; bodies over 480 characters are blocked. Account-specific observed costs remain unknown. A timeout or worker crash after an attempted SMS becomes `reconciliation_required`; this adapter establishes no safe provider idempotency contract, so it never automatically resends an uncertain message. Operator/provider evidence must resolve an unknown outcome before a new operation.
4. Preserve an actual Twilio Message SID and complete a consent-safe recipient verification/download smoke before claiming live phone delivery. `reconcile_delivery` retrieves provider state for known accepted IDs without resending. No live SMS was sent during this implementation.

Both external channels also create the inbox item immediately when the verified receiving account already matches. Otherwise accepted transfers can be claimed by the matching verified account from Received, until expiry. App delivery and external notification have separate evidence; notification failure cannot undo received bytes or refund a successful app delivery. Migration 0004 preserves existing email destinations, channel and version-1 bindings; all new transfers use the channel-bound version-2 form. Existing short-lived browser proofs may require fresh verification after upgrading.

## File checks and resource limits

`text_only` accepts validated UTF-8 TXT/Markdown/CSV and rejects binary/control bytes. It is not a full malware scanner. PDF/DOCX remain quarantined until `SCAN_ADAPTER=clamav` and `CLAMAV_HOST` are configured. ClamAV receives a bounded private stream; extraction runs in a subprocess with CPU, timeout, ZIP expansion, page, and text limits. Use a container memory limit. OCR, encrypted PDFs and unsupported types remain unavailable.

`content/plans.json` versions the $0/10, $5/500 and $20/unlimited-file-count experiment. Storage, per-file size, bandwidth and model budgets are separate and disclosed. Quota reservations use transactions and row locks, and UTC free periods are separate from paid provider periods. Fixture and live periods are separate. A download attempts the exact hash and debits bandwidth when its response starts, including repeats or interrupted downloads. Owner export does not consume send quota. No overages are charged.

## Billing

Configure separate Plus and Unlimited monthly Stripe Products/Prices matching the versioned USD prices. Use a restricted API key, webhook signing secret, and customer portal. Register `/webhooks/stripe/` for subscription changes, checkout completion/expiry and invoice paid/payment-failed events. The SDK's pinned API version is recorded in `uv.lock` through its package version; this build uses Stripe Python 15.x. Verify account API compatibility during sandbox activation.

Only verified events plus authoritative subscription retrieval update entitlement. Events are deduplicated; current provider state handles arrival order. Sandbox entitlements cannot become live customer entitlements. Canceled and past-due subscriptions fall back to free. A scheduled cancellation keeps active entitlement until the authoritative period ends. Export remains available. Live keys require `STRIPE_LIVE_ENABLED=1`; keep it off until founder approval. Tax registrations, refund policy, receipts/revenue reconciliation and account readiness require operator completion. Do not enable automatic tax without verified registrations.

## Feedback and releases

Configure a real product subreddit URL for the public invitation. Approved commercial Reddit API access is still missing; automated Reddit ingestion/replies are disabled. Use the app form while approval is pending. Do not scrape or manufacture attendees. Public feedback includes explicit consent and automatic redaction, which can miss details; private support bodies stay in the customer plane. Authors can withdraw submitted text, including the stored builder request. Existing published Git history and provider transcripts may need separate retention handling.

The automatic release boundary is exactly `content/help.json`, plain text in one existing section. Everything else needs operator review. The remote builder has no file or shell tools and cannot change that boundary. Tool permissions, budgets and connected identities are checked before a session starts. Real `ses_` IDs and metered costs are recorded. Local fixture proposals require an explicit test-only environment flag and cannot release live.

The trusted controller creates an isolated worktree. Set `COMPANY_VERIFIER_IMAGE` to an immutable Docker image ID/digest labeled with the exact baseline source SHA. The independent suite runs with no network, no secrets, no customer mounts, read-only root, dropped capabilities, a temporary filesystem, CPU/memory/time limits, and baseline tests. A source change requires a new trusted verifier image. The builder cannot edit this baseline or CI.

`run_company --release-worker` must run separately with only the company database and a scoped release GitHub App token. Configure `RELEASE_GITHUB_REPOSITORY`, `RELEASE_GITHUB_TOKEN`, `DEVELOPMENT_APP_URL`, and explicit `COMPANY_RELEASE_ENABLED=1`. The controller requires protected `dev`, exact baseline/head/content, passing `integration` and `release-boundary`, and GitHub's merge policy. It never passes admin/bypass options and never promotes `main`.

After a dev merge, the deployment workflow must produce a development deployment matching that SHA. The controller verifies `/health/` release identity and the help page before issuing a requester notification. Without that evidence the release is incomplete. Protected production promotion still needs a founder release request. Company-owned feature worktrees remain until the controller records their exact GitHub merge and the operator's recoverable worktree retirement is available; automatic Codex-managed retirement is performed for this implementation chat, not silently simulated by the app.

## Hosting activation and rollback

1. Provision the host and two PostgreSQL databases with separate non-admin roles. Provide independent env files under `/etc/fyde/` for web, delivery, bridge, company, and marketing. Never place them in Git or Docker build context.
2. Configure TLS/reverse proxy and allowed hosts. Set `DJANGO_DEBUG=0`, a random application secret, HTTPS origin, secure storage and encrypted backups. Only enable `TRUST_PROXY=1` when the proxy strips and controls forwarding headers.
3. Review migrations and run them once through the operator's migration role, including `--database company`. Create the real operator with `createsuperuser`; never use the fixture operator publicly.
4. Initialize named volumes with UID/GID 10001. Install a root-owned copy of `ops/deploy.sh`, the production compose file, and a constrained SSH forced-command wrapper. The wrapper must parse exactly `fyde-deploy IMAGE SHA`, reject other commands, and call the script with quoted arguments. Pin SSH host keys. Give the host read-only registry access.
5. Configure GitHub's `development` environment, `DEVELOPMENT_DEPLOY_HOST`, `DEVELOPMENT_KNOWN_HOSTS`, `DEVELOPMENT_DEPLOY_SSH_KEY`, `DEVELOPMENT_APP_URL`, and `DEVELOPMENT_DEPLOY_ENABLED=true`. Require protected `dev` and the fixed CI checks before activating unattended releases.
6. The workflow builds/pushes a SHA-labeled immutable image, runs the constrained host command, and checks the hosted identity. The host script retains the prior image, switches services, and restores that prior image if health or help checks fail. It never runs migrations automatically. Monitor the job and hosted worker heartbeats; a skipped deployment is not a successful deployment.
7. For later regressions, pause affected workflows, use `/etc/fyde/previous-image.env` to redeploy the prior immutable artifact, verify health and affected behavior, record an Incident and rollback time, then investigate in a new feature branch. Backups and a restore drill remain required; a passing health check does not prove a recoverable backup.

The deployment script and rollback path are supplied and statically checked; hosted deployment/rollback have not been exercised because no host or credentials exist. Automatic rollback currently covers immediate deployment smoke failure. Continuous application-regression detection and delayed automatic rollback remain incomplete.

The customer deployment now uses the [Cloudflare and Neon Functions workflow](cloudflare-neon.md). The container/SSH instructions above apply to the retained Python company runtime. Hosted customer deployment does not activate the company workers or release controller.

## Instagram and schedules

The implemented adapter uses **Instagram API with Facebook Login**, a professional account linked to a Page, and approved publishing permissions. Do not mix in Instagram Login tokens/scopes. Configure the current `INSTAGRAM_API_VERSION`, Page token, account ID, and operator approval flag. Publishing is disabled by default. Public HTTPS asset URLs and a reachable public product CTA are required; a localhost demo package cannot publish.

The source catalog is curated and versioned. Research verifies exact support anchors on current primary pages, preserves a retrieval timestamp/hash/excerpt/qualification, and fails if evidence changes. It does not infer causality, invent survey statistics, or obey source-page instructions. The renderer checks deterministic text bounds, JPEG dimensions, hashes, and final CTA. Operators should inspect each new template on a phone before enabling its unattended cadence.

Set `MARKETING_AUTORUN=1` only after approving account, subjects, template and cadence. The marketing worker enqueues one daily experiment, reuses its active artifact, publishes when authorized, and requests daily insights for real posts. `INSTAGRAM_MAX_PER_DAY=1` is the default. The app persists child/parent container IDs before publish. An uncertain final side effect is reconciled against the existing parent and exact caption; it is never blindly repeated. Unsupported metrics remain null. Individual slide completion and exact per-post revenue are not available.

## Pause, recovery and economics

Staff can pause company work at `/company/`; customers can independently pause all sharing or a contact. Pause does not reverse messages/posts already accepted. Jobs retain trace IDs, leases, bounded attempts and safe error codes across restarts. A historical heartbeat is not proof of a currently supervised process. Default company paid budgets are zero. Estimated email/model reservations are distinct from observed invoices.

[Economics](economics.md) records the explicit cost model and missing measurements. Revenue reporting and provider-invoice reconciliation remain incomplete. For suspected disclosure, pause sharing and company releases, revoke affected grants, preserve restricted audit records, and escalate to the accountable operator. Do not let a model edit permissions, spending caps, refund rules, or this runbook to clear an incident.
