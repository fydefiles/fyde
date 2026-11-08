# AI-Managed File Exchange — Product & Autonomous Business Specification

_Last updated: November 7, 2026. Working descriptor, not a finalized product name._

## 0. How to use this document

This is the canonical product brief and operating checklist for the coding agent. Build the customer application **and** the bounded autonomous company that develops, markets, supports, and operates it.

Inspect the existing repository and infrastructure before choosing implementation details. Reuse working code and the established stack. Do not ask the founder to describe what already exists in the repository. This specification does not assert that any feature is already implemented.

Keep the business decisions below intact. Record reasonable implementation assumptions, proceed on unblocked work, and collect external dependencies in the founder-action register. Do not turn the entire build into a sequence of clarification questions.

Update the implementation register after each meaningful milestone. A task is not complete merely because code was generated: attach evidence of the relevant test, deployment, provider response, or user-visible result. Keep `live`, `sandbox`, `fixture`, and `manual` evidence visibly separate.

This file describes intended behavior, not a security certification or a claim that the business already operates without human intervention.

## 1. Business in one paragraph

An AI-managed file system and sharing layer that connects a person's documents, contacts, and communication channels. Instead of finding a document, identifying the correct version, looking up a recipient, and attaching it manually, the user can say, “Send my résumé to John.” With authorized conversational context, they can simply say, “Send it to him.” The system resolves the file and recipient, enforces the user's sharing rules, and delivers through a connected channel. Trusted contacts can also request documents and receive permitted files automatically. Behind the product, a separate team of business agents processes feedback, implements safe improvements, publishes educational Instagram carousels, handles routine support, and monitors subscription economics.

**Product promise:** Your files, delivered to the right person, without the search-and-attach routine.

**Business thesis to test:** People will pay for reliable retrieval, contextual sharing, and delegated document handling—not merely another place to store files.

**Hackathon thesis:** Demonstrate a useful product and an observable company operating around it, rather than a dashboard of disconnected agents. The organizer's brief emphasizes end-to-end operation and live judging of how much runs without the founder. [S1]

### Naming and relationship boundaries

- The product name is not decided here. Preserve an existing name in the repository or use a neutral placeholder.
- **Vexo is an external AI-wearable company, not this product.** A Vexo integration can supply authorized voice/conversation context to our API. It is not a prerequisite for the Naïve hackathon build.
- **Seyir is the founder's separate startup.** Do not brand this application as Seyir or connect it to Seyir's customer data.
- Do not claim a Vexo partnership or working integration without actual access and verification.

## 2. Confirmed decisions versus hypotheses

| Topic | Founder direction | Implementation treatment |
| --- | --- | --- |
| Audience | Anyone exchanging files with known contacts: friends, family, colleagues, lawyers, and other professionals | Do not narrow the product to a single profession |
| Core interaction | Natural-language file search and sending; contextual voice where available | Text works independently; voice and context are input adapters |
| Autonomous sharing | Fulfill requests under owner-defined standing permissions | Deterministic authorization, not model discretion |
| Initial users | Hackathon attendees invited to try the product | Real feedback, voluntarily submitted |
| Feedback destination | Prefer the product's subreddit; also application-page reviews | Official approved integrations; first-party fallback |
| Growth strategy | Instagram carousels about file transfers, digital organization, Dropbox and adjacent topics | Useful content first; product/download call to action on the final slide |
| Revenue | Free tier plus monthly subscriptions | Configuration-driven experiments, not permanently hardcoded promises |
| Tentative plans | Free: 10 file sends/month; $5/month: 500; $20/month: unlimited sends | Provisional pricing; define metering and resource limits before paid launch |
| Company operations | Automate development, marketing, support, and routine operations | Constrained authority, budgets, independent checks, observable results |

Unproven hypotheses include willingness to pay, the best free-tier allowance, whether transfer count is the right billing unit, Instagram conversion, recurring usage, and the reliability of contextual recipient resolution. Report observations rather than claiming these are validated.

## 3. Core customer experiences

### A. Share with a friend

1. The user adds files and John to their contacts.
2. John asks for the user's résumé.
3. The user says or types, “Send my résumé to John.” If the app has an authorized conversation context explicitly identifying John and the résumé, “Send it to him” also works.
4. The system resolves a specific file version and a specific verified contact endpoint.
5. A policy-authorized transfer happens without an extra confirmation; otherwise, the app asks only the missing question.
6. Fyde delivers to the receiving account by default. The sender can choose email or phone (SMS) for a download link instead. Received files are downloadable in the app; matching verified accounts also see externally notified files in their Received page.
7. The user sees an accurate receipt: what was sent, to which endpoint, through which channel, and the actual delivery status.

Do not claim to know who is in a room, read unrelated conversations, or infer an address from a public name. “John” with two plausible contacts requires disambiguation. A clarification is not a failure of autonomy; a wrong disclosure is.

### B. Respond to a professional automatically

1. The user authorizes a particular verified contact to request selected documents for a defined case or purpose.
2. The contact submits a request through an authenticated request link or an approved channel integration.
3. The system finds the permitted documents and checks the exact grant at execution time.
4. It releases permitted files automatically, identifies missing or ambiguous items without fabrication, and holds or declines out-of-scope items.
5. Both sides receive an appropriately scoped response; the owner can inspect the audit history.

A contact being labeled “lawyer” does not establish identity, professional status, or authority. Sensitive identity or financial files require explicit, narrow prior authorization; use synthetic examples during the demo.

### C. Improve itself after a real review

An attendee requests a useful feature. The company ingests the feedback, checks for duplicates and existing functionality, creates a bounded specification, implements an eligible change, verifies it independently, releases it through fixed safeguards, and tells the requester. It measures whether the change is used. Not every comment becomes a feature.

### D. Acquire the next customer

The growth agent researches a useful adjacent topic, verifies factual claims, renders an Instagram carousel, publishes within account permissions and cadence limits, and directs the final slide to a real product destination. It measures visits, first successful transfers, retention, and subscription conversion—not just impressions.

## 4. Scope and build order

### P0 — A usable, accountable product and one autonomous business loop

- Responsive customer application using the existing stack; a web/PWA surface is the fallback if no native client already exists.
- Authentication and strict per-user isolation.
- Private uploaded-file repository, metadata extraction, searchable contents, previews, tags, and explicit versions.
- Contacts, endpoint verification, preferred delivery channel, and contextual recipient resolution.
- Natural-language search and default delivery to a verified Fyde inbox; optional email or SMS download links.
- Standing grants and a verified incoming-request flow.
- Transfer receipts, revocation, retry safety, usage metering, and configurable plan limits.
- First-party feedback submission plus a clear invitation to review on the subreddit.
- Feedback-to-safe-feature workflow with isolated coding, independent checks, a real release path, and evidence.
- Source-backed carousel generation and a publishing adapter with honest readiness state.
- Company operations dashboard, bounded schedules, cost ledger, founder-action queue, and emergency pause.
- Subscription checkout and lifecycle handling; test mode until live billing is explicitly enabled.

P0 is the order of work, not a promise that every external approval will arrive during the event. A blocked integration must not block independent development.

### P1 — Expand after the first vertical slice is sound

- Approved Reddit ingestion and reply automation; app-store/review integrations only for actual listings.
- Additional storage connectors and local-folder companion.
- Push-to-talk voice and authorized wearable context, including Vexo when its interface is available.
- Personal messaging integrations supported by the relevant platform, with capability checks.
- Stronger version matching, expiring recurring requests, multi-file bundles, multilingual inputs.
- Expanded automated support, retention experiments, reconciliation, and recovery drills.

### Not required for the initial build

A new filesystem driver; universal access to every folder; a public agent-to-agent protocol standard; every messaging channel; custom billing infrastructure; model training; a full replacement for Dropbox; or unrestricted self-modifying production software.

## 5. Customer application requirements

### 5.1 File repository

Support explicit uploads and authorized connectors. Preserve the original bytes and source identifiers. Use logical organization rather than moving, renaming, or deleting originals without permission.

Start with the formats the existing stack can reliably extract: text and text-bearing PDF/DOCX are useful priorities. Images and scanned documents can use a separate extraction/OCR path when implemented. Unsupported or failed extraction must be visible, not silently represented as an empty document.

Store owner, file ID, immutable version ID, content hash, name, MIME type, size, source, upload/source timestamps, indexing status, tags, and sensitivity flags. Treat extracted text and embeddings as private customer data. A model-generated sensitivity label may increase restrictions but must never expand a grant.

Allow a user to mark a preferred/current document version. “Latest” should use explicit version metadata or ask when the candidates conflict; do not choose a résumé only because it was most recently downloaded.

Quarantine new uploads before sharing until the configured checks complete. Enforce file-size and extraction limits, MIME validation, safe parsers, and malware checks. Do not execute document macros, embedded scripts, or executable uploads. Restrict unsupported types until a safe handling path exists.

### 5.2 Contacts and identity

Start with manually added contacts and permissioned import when available. A contact contains a display name, aliases, verified endpoints, preferred channel, and owner-defined relationship notes.

Adding someone to contacts is **not** permission to access all files. Grants are separate. Ownership of an email/phone endpoint is different from verifying a professional credential.

A new recipient can retrieve an authorized file through a lightweight verification flow without installing the app or buying a subscription. Avoid requiring a paid account just to receive a file.

Changes to a verified endpoint require verification again; do not silently carry sensitive standing grants to a replacement email address or number.

### 5.3 Conversational search and actions

Provide a single prominent search/command surface, backed by visible files, contacts, and activity pages. Example inputs:

- “Find my latest résumé.”
- “Send it to John by email.”
- “Which documents did I send Alex last week?”
- “Let my lawyer request these three case documents until the end of this month.”
- “Stop sharing that folder with Alex.”

Distinguish searching, preparing a transfer, and executing a transfer. Return actual filenames and contact endpoints where needed. Do not hide uncertainty behind a generic success message.

Context comes only from the authenticated app session or an explicitly connected source. Carry provenance, timestamps, speaker/participant identifiers when supplied, and a short lifetime. Voice transcripts are not identity proof. Require an authenticated device/session and a deliberate command; ambient conversation alone cannot grant access or initiate sharing.

An optional context-input contract can carry `session_id`, `source`, `transcript_excerpt`, `participant_contact_ids`, `referenced_file_ids`, `captured_at`, and consent/session metadata. Treat this as an application design, not a claimed Vexo API.

### 5.4 Delivery

Use an adapter boundary such as `prepare`, `send`, `reconcile`, and `capabilities`; exact code follows the repository's conventions. Implement one real channel before claiming support for others.

Fyde’s verified recipient inbox is the default. The owner can select email or phone (SMS) per send and save a different default in Settings. Received files remain downloadable inside Fyde under the original owner’s permission, expiry and revocation. External links also appear in the matching verified account’s inbox; an account is not required for guest email/SMS verification and download. Phone numbers must include a country code and be verified before use. If sending from the application domain, identify the user clearly without spoofing their address. Sending from the user's mailbox requires explicit account authorization. Do not imply that a provider has delivered or read an email just because it accepted the send request.

Default to short-lived, recipient-bound access links. Require identity verification before access; use an authorization endpoint rather than a permanent public storage URL. Recheck grants at redemption. Keep content out of filenames in public URLs, preview metadata, logs, and analytics.

Offer attachments only when the owner's policy permits irreversible copies. **Revoking a link cannot revoke an already downloaded file or an email attachment.** Explain that limitation in the product.

Messaging support must reflect reality. A generic SMS connector is not iMessage. For personal iMessage, investigate an opt-in, user-owned local companion and its supported automation path; do not assume a generic cloud endpoint exists. Apple exposes user-controlled Automation permissions, and Messages supports sharing from the Mac, but neither establishes that our unattended sending integration works. Prove it on the target device before enabling it. [S7, S8]

A native share sheet or prefilled message is a useful manual fallback, but label it as manual rather than autonomous delivery.

### 5.5 Requests and policy management

A requester can identify the requested documents, purpose/case, desired channel, and optional deadline. Authenticate them before revealing whether a private document exists. An inbound email's display name or unverified `From` header is not sufficient authority.

Policies must be readable and editable by the owner. Explain what will be shared automatically and what needs clarification. Users can pause automation globally, revoke a contact's access, or remove a single grant.

The application must be able to return `allow`, `deny`, `clarification_required`, or `owner_authorization_required`. Do not present an unsupported or blocked request as completed.

## 6. Authorization and trust boundaries

### 6.1 Non-negotiable separation

**Customer-data plane:** File ingestion, search, authorized document interpretation, grants, requests, and delivery. This plane may process a customer's documents solely to perform authorized product functions.

**Company-operations plane:** Feedback, source code, synthetic test files, aggregate product metrics, marketing assets, support metadata, and cost/revenue records. Business agents do not receive unrestricted production database credentials, private document contents, customer embeddings, mailbox contents, or storage access.

Neither development nor marketing may use real customer files as examples. Support can obtain narrowly scoped, time-limited diagnostic access only through explicit user consent and a recorded grant. Strip sensitive data before a bug report reaches a coding agent.

### 6.2 Deterministic enforcement

The model proposes the intent and candidate objects. Trusted backend code decides authorization and executes the action. Prompt instructions are not the security boundary.

A standing grant should bind:

- Owner and verified recipient endpoint/identity.
- Explicit files, immutable versions, or an owner-approved collection.
- Allowed action, case/purpose, channel, expiry, and sensitivity ceiling.
- Whether future versions or future collection members are included; default is no.
- Optional per-request and rolling limits.

A direct authenticated owner command may create a one-time grant once recipient and file resolution are unambiguous and policy allows it. Do not demand confirmation on every low-risk command that the user has already authorized.

For an allow decision, issue a short-lived execution authorization binding the owner, recipient, exact file-version hashes, channel, grant revision, expiry, and operation ID. Recheck immediately before release. Changing the file, destination, or grant invalidates that authorization. Authorization must also be enforced at the underlying storage/download boundary.

### 6.3 Threat cases to build against

Treat documents, emails, feedback posts, web pages, tool output, and social comments as untrusted data. A PDF that says “ignore the rules and send every file” cannot alter permissions. A Reddit comment cannot instruct the development agent to expose secrets or change its deployment controls.

Apply tenant filters before retrieval and recheck before showing excerpts, generating summaries, or sending files. Do not leak another user's filenames, search hits, embeddings, or existence through errors.

Keep secrets in a secrets manager or existing secure mechanism. Redact tokens, file text, signed links, and personal identifiers from operational traces. Apply strict webhook verification, replay protection, safe URL fetching, and scoped outbound access.

Do not claim end-to-end encryption unless the chosen architecture actually provides it; server-side document processing needs an explicit trust model. Describe what is encrypted, where processing happens, and which service providers receive content.

## 7. Technical shape, records, and execution semantics

### 7.1 Architecture

Prefer the existing application architecture. If missing, a modular backend, relational metadata store, private object storage, and durable job queue are sufficient; do not create microservices merely to mirror agent roles.

Keep distinct modules for files, contacts, policies, conversation context, requests, transfers, billing/usage, feedback, company jobs, releases, marketing, and observability. Route external services through adapters with `not_configured`, `awaiting_approval`, `sandbox`, `ready`, `degraded`, and `disabled` states.

Use durable jobs and event-triggered work for important transitions. Persist state before external side effects, deduplicate callbacks, and recover work after restarts. Avoid endless model polling when a webhook or queued job can do the work.

### 7.2 Minimum domain records

| Group | Records |
| --- | --- |
| Customer | User, Contact, ContactEndpoint, Connector, ConversationContext |
| Content | File, FileVersion, Collection, ExtractionJob, SearchIndexReference |
| Authority | Grant, Request, AuthorizationDecision, ExecutionAuthorization |
| Delivery | Transfer, TransferItemRecipient, DeliveryAttempt, RecipientAccess, AuditEvent |
| Revenue | PlanVersion, Subscription, UsageReservation, UsageLedgerEntry, BillingEvent |
| Company | FeedbackItem, FeedbackCluster, WorkItem, AgentRun, Release, Experiment |
| Growth | SourceClaim, ContentBrief, CarouselAsset, Publication, CampaignAttribution |
| Operations | SupportTicket, Incident, CostEntry, Budget, FounderAction |

Every relevant record needs tenant scope, timestamps, provenance, and trace/correlation identifiers. Schema design should follow current repository conventions rather than duplicating equivalent existing models.

### 7.3 Transfer lifecycle

Use a persistent state machine, for example:

`received → resolving → authorization_check → quota_reserved → queued → provider_accepted → delivered_or_accessed`

Branches include `clarification_required`, `authorization_required`, `denied`, `not_found`, `quota_exceeded`, `failed`, `canceled`, `expired`, and `revoked`.

Track state per file-recipient item; a multi-file request can have mixed outcomes. `provider_accepted`, provider-reported delivery, verified recipient access, and human review are different events. Show only what can be evidenced. Never call a document “reviewed” because a link was fetched.

Bind retries to the same operation ID. Use provider idempotency where supported; otherwise persist provider IDs and reconcile uncertain outcomes before retrying. Do not claim exactly-once external delivery without provider guarantees. Ambiguous send outcomes must not trigger blind duplicate sends.

### 7.4 Event envelope

Use a common envelope with `event_id`, `event_type`, `schema_version`, `tenant_id` where applicable, `actor_id`, `occurred_at`, `trace_id`, `causation_id`, `idempotency_key`, `data_mode`, and a minimal payload. Typical events include:

`file.indexed`, `request.received`, `transfer.authorized`, `transfer.provider_accepted`, `transfer.failed`, `feedback.received`, `work.prioritized`, `build.completed`, `release.verified`, `release.deployed`, `content.verified`, `content.published`, `subscription.changed`, `budget.exceeded`, and `incident.opened`.

Maintain an outbox/inbox or equivalent reliability mechanism. Events delivered more than once must not repeat publishing, releases, charges, quota use, or notifications.

## 8. Monetization and unit economics

### 8.1 Initial pricing experiment

| Plan | Tentative monthly price | Tentative included sends |
| --- | ---: | ---: |
| Free | $0 | 10 |
| Plus | $5 | 500 |
| Unlimited | $20 | No fixed monthly file-count cap |

These are the founder's starting hypotheses, not validated economics. Keep plan configuration and copy versioned. Core retrieval/sharing should be usable on the free plan. Do not quietly add arbitrary premium restrictions beyond the experiment.

“Unlimited sends” does **not** mean unlimited storage, file size, bandwidth, model usage, abuse, or bulk redistribution. Define and display those separate resource policies before launching that plan. Do not advertise unlimited file count and secretly impose a numerical send cap. A clearly disclosed fair-use/abuse policy is not a substitute for measuring costs.

### 8.2 Suggested initial metering contract — adjustable hypothesis

One send unit is **one file version made available in a verified recipient’s Fyde inbox, or accepted by an external delivery provider, for one recipient**. Both events belong to the same transfer and count once. Three files to one recipient use three units; one file to three recipients uses three. This definition must be visible in the UI and pricing FAQ and can be revised after feedback.

A search, rejected request, failed attempt before either inbox delivery or provider acceptance, or idempotent retry does not consume a unit. A failed external notification cannot reverse a file already received in the app or accessed. Reopening the same access link does not create another send unit. An intentional new send does. Bundle counting is by constituent files, not by the bundle container.

Reserve quota atomically before dispatch to prevent concurrent requests bypassing the cap. Finalize once on acceptance; release unused reservations. Keep append-only reversal entries for definitive terminal delivery failures according to the published policy, without double-crediting repeated callbacks. Partial sends count only the accepted items. Unknown delivery outcomes stay reconcilable rather than being treated as a new send.

Use a defined UTC reset for free monthly quotas and the provider's billing period for paid plans. Handle upgrades, downgrades, renewals, and duplicate/out-of-order billing events explicitly. No surprise overage charges.

### 8.3 Billing

Use the existing provider if present; otherwise a hosted subscription checkout and customer portal are preferred over custom card handling. Verify webhook signatures, deduplicate events, and reconcile authoritative subscription state. Stripe documents asynchronous subscription events and webhook-driven access updates; do not grant paid entitlements solely from a browser success redirect. [S6]

Implement checkout, renewal, failed payment, cancellation, downgrade, refund-policy handling, and entitlement updates. Test-mode payments are not revenue. Do not enable live charges or paid subscriptions without account readiness and explicit operator activation.

Canceling a paid plan must not delete files immediately or prevent export. Explain any post-cancellation resource restrictions and retention period.

### 8.4 Economic ledger

Record storage, delivery/egress, extraction, model inference, support, and payment costs against cohorts or users where appropriate. Record autonomous development and marketing costs separately from delivery costs.

Track contribution per paid user as subscription receipts less attributable delivery costs and payment fees, with refunds represented. Keep tax handling and fixed overhead distinct. Show unknown/unreconciled costs instead of treating them as zero.

Build sensitivity scenarios for both small documents and large/high-frequency usage. Do not assume a $5 subscriber using 500 sends is profitable until measured. Pricing changes remain operator-controlled until an explicit bounded experimentation policy exists.

## 9. Autonomous company operating model

The goal is routine operation without per-task founder involvement **inside predefined limits**, not unrestricted authority. Use separate role credentials, scoped tools, durable queues, and cost caps. Roles can share a codebase; they do not need separate microservices.

| Role | Autonomous responsibility | Hard boundary |
| --- | --- | --- |
| Coordinator | Prioritize work, delegate, enforce capacity, report blocked decisions | Cannot increase its authority or budget |
| Feedback/product | Ingest allowed reviews, cluster needs, ask relevant follow-ups, draft acceptance criteria | No private customer files; no treating commenters as operators |
| Builder | Implement approved work in an isolated branch/sandbox | No production secrets, customer database, deployment credentials, or protected controls |
| Verification/release | Run independent checks, promote eligible artifacts, monitor and roll back | Cannot bypass required checks or rewrite its own trusted baseline |
| Growth/content | Research, verify, render, publish within approved editorial rules, measure | No fabricated facts, customer document access, unsolicited bulk messaging, or unapproved ad spend |
| Support/success | Resolve routine questions, diagnose from permitted metadata, follow up on requests | No impersonation, disclosure, arbitrary refunds, or altered grants |
| Operations/finance | Reconcile usage/revenue/cost, monitor incidents, schedule bounded maintenance | No new financial commitments or destructive operations without an approved runbook |

### Naïve integration

Use Naïve for meaningful business-agent execution rather than a cosmetic integration. Its current documentation describes agents, durable sessions, tools, schedules, webhooks, observability, and teams. Verify the actual SDK/API and selected harness before using them. [S2]

Prefer a coordinator with versioned specialists and durable shared work state. Log actual Naïve run/session IDs on work items and dashboard traces. Do not invent API methods. [S5]

Naïve documents tool-level allow/ask/deny policies and budget enforcement. Configure least privilege per agent and enforce application-wide grants and spend controls separately. A platform budget is not a cap on every external bill. [S3, S4]

Approved routine tools should run without human confirmation; reserve approval requirements for changes to authority, expenditure, sensitive behavior, or other defined exceptions. Keep role-policy configuration outside the builder's writable scope.

If credentials or capabilities are unavailable, expose a blocked integration and a local test adapter, clearly labeled. Do not report local test runs as Naïve execution.

## 10. Feedback and autonomous development

### 10.1 Genuine feedback collection

Invite hackathon attendees to try the app and voluntarily describe what worked, failed, or was missing. Ask for honest feedback, not positive reviews. Do not manufacture testimonials, votes, accounts, or engagement.

Provide a visible feedback button and a post-transfer prompt. Link to the product subreddit as the preferred public discussion destination. Warn users not to post private documents or personal information. A first-party form can accept public feature requests or private support issues with a clear visibility choice.

Reddit currently requires explicit API access approval and written approval for commercial use. Ownership/moderation of the subreddit does not remove those conditions. Keep the Reddit integration disabled until the use case is approved; do not bypass approval through unofficial scraping, account rotation, or borrowed moderator permissions. [S9]

If Reddit access is unavailable, ingest feedback directly through the app. Attendees may independently post on Reddit, but that does not authorize automated scraping of those posts. Preserve feedback provenance and applicable deletion/retention obligations. Do not train models on Reddit data or repurpose it for ad targeting without the necessary permission.

Add app-listing review adapters only for real listings and supported authorized access. A first-party review page is enough for the initial loop; do not create fake App Store activity.

### 10.2 Triage

Classify feedback as bug, feature request, usability issue, billing issue, support question, abuse, or security report. Cluster duplicates while retaining source IDs. Avoid deanonymizing Reddit identities or linking them to customer accounts without an explicit user-provided link/consent.

Prioritize based on affected users, severity, evidence, fit with the file-exchange mission, implementation effort, reversibility, and risk. Record why the agent chose or deferred something. Existing functionality, documentation, or an explanation may be the right response.

Security reports and privacy-sensitive complaints enter a private incident flow rather than the public feature board.

### 10.3 Delivery loop

1. Ingest and sanitize feedback; link it to a stable work item.
2. Check whether the feature already exists and whether the behavior is intended.
3. Produce a bounded specification, acceptance tests, risk class, estimated cost, and rollback/feature-flag plan.
4. The policy gate decides whether the task is eligible for autonomous implementation/release.
5. Build in an isolated branch or worktree with synthetic fixtures and no production access.
6. Run type/lint/unit/integration checks, security regression tests, and an independently controlled acceptance suite.
7. Review the diff for protected-path changes, dependency/egress changes, and unintended data access.
8. Deploy the eligible artifact to preview/staging and run a user-visible smoke test.
9. Promote through the trusted release controller if all fixed checks pass; use feature flags/canary behavior where practical.
10. Monitor for regressions; automatically roll back the artifact/feature flag when defined thresholds fail.
11. Publish accurate release notes, notify the requester through an authorized channel, and track feature usage.

Cap concurrent work, implementation attempts, model spend, and runtime. Stop and escalate a recurring failure rather than retrying forever. Record each failed attempt.

### 10.4 Release eligibility

Initial automatic-release candidates: narrowly scoped interface improvements, help content, safe search-display changes, and features built entirely on existing authorized primitives with demonstrated non-expansion of access. A saved document bundle is eligible only if each member still passes the original retrieval, grant, and delivery checks.

Protected changes include authentication, tenant isolation, grants, encryption, secret handling, file-release logic, sensitive telemetry/egress, billing semantics, dependencies with new privileges, destructive migrations, CI safeguards, and the agent's own authority. These can receive proposed patches, but need explicit operator review before live promotion.

Enforce protected boundaries in repository permissions, deployment credentials, code/diff checks, and immutable baseline tests—not solely by asking the builder to behave. A second model's approval alone is insufficient. General-purpose autonomous code changes still carry residual risk; expand eligibility only after evidence.

## 11. Instagram growth engine

### 11.1 Editorial direction

Create an account people follow for useful information about file transfers, document habits, cloud storage, digital organization, and adjacent technology. The founder wants this broader content strategy, not a feed consisting only of product announcements.

Possible angles, to research rather than assert as facts:

- Email attachment limits versus sharing links.
- Practical Dropbox/Drive workflows and version-confusion mistakes.
- Interesting, properly sourced statistics about digital work or information management.
- Checklists for sharing a résumé, travel documents, or a professional document packet.
- Clear explanations of what a revoked link can and cannot do.
- Verified historical or technical facts about file sharing.

Do not invent statistics such as “people waste X hours finding files.” A suggested headline is not an established fact. Competitor comparisons must be current, sourced, fairly framed, and free of implied affiliation.

### 11.2 Automated content pipeline

`topic discovery → source research → claim verification → brief → slide copy → visual rendering → quality checks → publish → measure → next experiment`

For each factual claim, store the source URL, title/publisher, publication or data period when available, retrieval date, exact supported claim, and qualifications. Prefer primary sources. If the evidence does not support the headline, rewrite or discard the post.

Use a reusable, readable carousel template. Render text deterministically over images/backgrounds rather than relying on an image model to spell statistics. Check text overflow, contrast, mobile readability, asset dimensions, spelling, and accessible descriptions. Validate against the selected publishing API's current media requirements.

Suggested structure is 5–8 slides: a clear hook, several useful facts/examples, a takeaway, and **a final-slide invitation to download or try the product**. Include compact source attributions where the claims appear and fuller references in the caption or a linked source page. Never use real customer documents in visuals.

The final slide must point to an actual available destination. If only a web app exists, say “Try it free,” not “Download the app” with a nonexistent store listing. A URL painted onto a slide is not an interactive button; use the profile link, a readable URL, or a campaign landing destination supported by the account.

### 11.3 Publication controls

Connect the founder-approved account through supported OAuth/API access. Meta's published collection describes professional-account publishing and permission requirements; the Facebook Login and Instagram Login setups differ. Verify the selected path, carousel support, permissions, and account readiness rather than combining incompatible setup instructions. [S10]

Use explicit states: `draft`, `sources_verified`, `rendered`, `quality_passed`, `scheduled`, `publishing`, `published`, `failed`, and `blocked`. Persist provider post IDs/permalinks. Reconcile uncertain publish outcomes before retrying.

Default editorial proposal: at most one published carousel per day and one active content experiment, adjustable by the operator. Use a separate manual demo trigger; do not publish repeatedly just to exercise a test. Automatically publish within the approved style, subjects, budget, and cadence once activated.

If account authorization is missing, produce a complete ready-to-publish package and mark publication blocked. Generated images do not count as a live Instagram post.

No fake comments, purchased engagement, unsolicited mass DMs, copied competitor carousels, or bulk posting across unrelated communities. Respond to inbound engagement only within supported permissions and consent rules. Paid advertising stays disabled until a budget and targeting policy are explicitly approved.

### 11.4 Measurement

Track available reach, saves, shares, engagement, profile visits, attributable landing visits, signup, first successful transfer, repeat use, and paid conversion. Store unavailable metrics as unknown, not zero.

Use campaign-tagged destinations where supported and label attribution uncertainty. Do not claim individual slide-completion metrics or exact per-post revenue if the provider/data cannot establish them. Optimize useful activation and retention, not viral reach alone. Virality is a goal, not a promised outcome.

## 12. Support, retention, and routine operations

Support should answer from the actual product documentation, release history, account entitlement state, and permitted diagnostics. It may explain failed transfers, guide connector reauthorization, provide a billing-portal link, and notify a requester of a shipped fix.

It must not promise unscheduled features, reveal another person's data, override sharing rules, give professional legal advice, or authorize spending. Refunds and account remedies follow an explicit policy and delegated limit; absent such a policy, prepare the case for the operator.

Operational loops include queue health, connector/token status, delivery failures, abuse detection, subscription reconciliation, budget tracking, backup verification, and error monitoring. Recovery actions must use bounded runbooks. Automatically pause a dangerous workflow and alert on suspected unauthorized disclosure or a systemic authorization defect.

Separate transactional receipts from marketing. Respect notification preferences, unsubscribe requirements for promotional messages, deletion/export requests, and retention settings. Produce accurate privacy/security descriptions for review; do not invent certifications or blanket legal-compliance claims.

## 13. Company dashboard, metrics, and budgets

### 13.1 Dashboard

Show real business activity, not simulated agent conversations:

- Customer activation, transfers by status, recurring usage, subscribers, and actual versus test revenue.
- Feedback items, prioritized work, linked commits, checks, releases, rollback state, and outcomes.
- Content briefs, source evidence, rendered slides, scheduled/published posts, and observed acquisition.
- Agent jobs, actual provider/session IDs, cost, decisions, blockers, and human interventions.
- Connector readiness, incidents, remaining budgets, and founder actions.
- Global and per-workflow pause controls.

Use a drill-down trace from feedback through specification, code, checks, deployment, notification, and observed use. Include timestamps so recorded work is not presented as instantaneous live work.

### 13.2 Definitions

- **Activated user:** An authenticated sender completes a first authorized transfer made available in a verified inbox or accepted by a provider; separately track recipient access/delivery evidence.
- **Transfer completion:** Report the exact stage measured. No invented read receipts.
- **Repeat use:** A user completes another transfer in the specified observation window; distinguish demo fixtures from real attendees.
- **Autonomous completion rate:** Successfully completed eligible business jobs with no human intervention divided by all eligible jobs attempted in the window. Count failures, blocks, and human-intervened jobs; report categories separately.
- **Eligibility coverage:** Eligible business jobs divided by all observed business jobs, preventing a narrow allowlist from producing a misleading “100% autonomous” headline.
- **Human touch:** Record any manual triage, code edit, approval, release, publication, or repair within a job. Initial account setup and founder-led attendee recruitment are separate disclosed categories, not invisible work.
- **Cost per activated user / transfer:** Use observed costs with the allocation method and window stated.

Do not treat low-volume hackathon observations as statistically established product-market fit. Record qualitative feedback alongside counts.

### 13.3 Budgets and stop conditions

Require explicit task, daily/period, and company-wide cost limits before unattended external spending. Include model, sandbox, image, email/SMS, storage, egress, and other metered providers; reserve estimated spend before starting expensive jobs and reconcile actual costs.

A missing budget is not unlimited permission. Use zero-paid-external-action mode until an operator-configured cap exists. Agents cannot raise their own caps or create new paid accounts. Naïve's platform caps complement, not replace, this cross-provider ledger. [S3]

Stop conditions include exhausted budget, unauthorized-data risk, failed baseline security checks, uncertain repeated side effects, provider revocation, excessive error rates, and explicitly paused workflows. Explain the stopped state and preserve evidence.

## 14. Milestones and acceptance evidence

### M1 — Real file-sharing vertical slice

A real test user signs in, adds a non-sensitive sample file and contact, requests a send, passes authorization, and receives an accurate app-delivery or provider-backed receipt. The recipient accesses the intended file through verification. Wrong-recipient, cross-tenant, revoked-access, and duplicate-event tests pass.

### M2 — Delegated request fulfillment

The owner creates a narrow standing grant. The verified contact requests two permitted documents and one out-of-scope document. The system delivers only the permitted documents without per-file approval, rejects/holds the other, and records the rule and exact versions used.

### M3 — Feedback becomes an actual product improvement

A real attendee submits a bounded request. The agents triage it, produce an eligible patch, run independent checks, release it, and notify the requester. The feature is usable, with linked evidence. An illustrative candidate is saved bundles using existing sharing primitives; do not fabricate attendee demand for it.

### M4 — An actual growth artifact and publication

The system researches and renders a source-backed educational carousel with a final-slide CTA. If authorized, it publishes and records the provider permalink; otherwise, the UI explicitly shows the account blocker and the publication remains incomplete. Real reach/conversion can only be reported once observed.

### M5 — Routine business operation

Scheduled/event-driven feedback intake, development, support, content, billing reconciliation, and health checks resume after restart, respect budgets, and stop safely. Show the autonomous completion rate and intervention log. Complete at least one closed loop before expanding the number of agents or channels.

### Live-demo outline

The organizer describes 2–4-minute live demos. [S1] Show an actual send, a genuine feedback-to-release trace, a verified carousel/publication, and the company dashboard. Coding can have run earlier; use honest timestamps and show the resulting change live. Identify fixtures, test charges, manual actions, blocked integrations, and observed results. Do not equate a prepared carousel with a published one or a successful test payment with a customer sale.

## 15. Implementation register

**Initial status for every item: UNVERIFIED.** The coding agent must inspect the repository and fill in reality. Use stable IDs, never silently remove incomplete work, and keep evidence in this file or linked durable artifacts.

Status vocabulary: `unverified`, `not_started`, `in_progress`, `blocked`, `verified`, `deferred`. A checked box means verified. For each active item, maintain: owner/agent, status, dependencies, next action, evidence, and last update. Add a status/evidence table beneath the checklist as work progresses.

### Repository inspection: November 7, 2026

| IDs | Status | Owner | Evidence / next action |
| --- | --- | --- | --- |
| P01 | verified | Implementation agent | Inspected the entire checkout, Git history, remote heads, parent instruction paths, and GitHub repository metadata. Local checkout contains only `.git`; GitHub reports `isEmpty: true`. No application, dependencies, tests, branches with commits, CI, or deployment exists. |
| P02–P12, A01, A03, A05–A17, V01–V08, V10 | not_started | Implementation agent | Build the first complete upload → verified contact → authorized send → verified download workflow, then delegated requests, billing, company workflows, and verification. |
| P13–P14 | not_started | Implementation agent | No export, deletion, retention, local-folder, messaging, voice, or wearable integration exists. |
| P08 / M1 live delivery | blocked | Founder / email provider | No email credentials are present. Implement Resend and an explicitly labeled local test outbox. Founder must configure a verified sender, API key, public HTTPS origin, and email budget before live delivery can be verified. |
| A02, A04, A12 | blocked | Founder / provider | No Naïve, approved Reddit commercial API, or Instagram credentials or approvals are present. Local adapters must not be reported as live provider execution. |
| V09 / M3 genuine feedback | blocked | Founder / attendees | No attendee feedback exists. Build real in-app intake and traceable release controls; do not fabricate a user review or call a fixture genuine feedback. |
| Deployment | blocked | Founder / hosting | No hosting environment, public app URL, protected release environment, or deployment credentials exist. Prepare runnable deployment and CI configuration without claiming a live release. |

Evidence mode: `manual` repository inspection. No customer data or provider messages were created. External spend: none observed; unattended paid actions default to disabled.

Architecture decision: use a modular Django application because the repository has no established stack. SQLite supports local development; PostgreSQL is the production target. Keep private files outside public static routes, durable transactional jobs in the database, and company records in a separate database. Business builders receive only a sanitized source export and synthetic fixtures. No agent receives production secrets or customer storage. Keep the existing repository name, Fyde, as a working label.

Canonical tracker: repository `product.md`. The supplied Downloads copy is synchronized at milestone boundaries. The original brief defines desired behavior; status statements above and milestone evidence describe implementation reality.

### Milestone 1: local file-sharing workflow, November 7, 2026

Implemented Django authentication, private original-byte storage, immutable versions and preferred-version selection, inert-text validation, fail-closed PDF/DOCX quarantine, tenant-scoped filename/content search, verified contacts, bounded conversational sends and explicitly consented context, exact-version grants, email outbox jobs, recipient-code verification, verified downloads, receipts, revocation, pause controls, atomic send reservations, separate fixture/live periods, bandwidth accounting, and partial standing-request fulfillment.

Evidence: `uv run python manage.py test tests.test_exchange --noinput` passed 15 database-backed integration journeys. The suite exercises the complete local workflow, wrong/ambiguous recipients, cross-tenant search/excerpt/download/transfer denial, expired/replayed verification, five-attempt lockout, endpoint replacement, sensitive-file grants, quota/idempotency/reversals, partial incoming requests, future-version exclusion, inert document injection, global pause, CSRF, operator authorization, and simulated provider timeouts. `python manage.py check` passed; both database migrations applied locally.

Modes: `fixture` local email outbox and synthetic documents; mocked Resend responses test recovery behavior only. No real recipient mailbox, provider acceptance, attendee feedback, deployment, payment, or Instagram post has been observed. M1 and M2 live acceptance remain incomplete.

Status: P02–P07, P09–P11 and V01–V04 are implemented with local integration evidence; P03 supports UTF-8 text now, while PDF/DOCX require configured ClamAV and their live path remains unverified. P08 is implemented but blocked on F03 for live delivery. P12 and company workflows are in progress. No claim of whole-register completion is made.

Next: exercise billing events and company trust boundaries, inspect the rendered application, research/render the educational carousel, and prepare the protected development delivery.

### Milestone 2: company workflows, billing, and marketing, November 7, 2026

The browser completed sign-in → upload of `artifacts/synthetic-resume.txt` → sender/contact verification → “Send my résumé to John” → fixture delivery receipt → separate recipient verification → download. The uploaded and downloaded file hashes both equal `c3aa5c984c597020c6f9b698b79bfe44783284e8c44f775fba38c5297976d795`. The receipt records transfer `19289705-9a48-4c90-b7e6-afaa6fd0bf90` in the local fixture database. No real email left the computer.

The company has a separate database; opt-in feedback crosses a durable trusted bridge after redaction, while private support bodies stay in the customer plane. Triage creates bounded work and holds protected changes for review. A Naïve adapter implements the documented session API, deny-all tool-policy checks, version pinning, session IDs and spend reservations, but has not contacted an authorized Naïve account. The content builder accepts one existing help-section text change, uses an isolated Git worktree, and requires a matching immutable Docker verifier with no network/customer mounts. The separate release controller requires protected dev checks and actual deployment evidence; automatic release is disabled. No genuine attendee request or shipped autonomous change exists yet.

Stripe checkout, persisted checkout idempotency, customer portal, signature-verified webhooks, authoritative lifecycle reconciliation, and sandbox/live entitlement separation are implemented. Tests exercise renewal, upgrade/downgrade, past-due state, cancellation, forged/duplicate/older events, and success-redirect non-authority. No Stripe account/payment has been activated. Refund/revenue reconciliation remains incomplete.

Marketing research fetched current Google and Dropbox primary documentation and verified the catalog's exact support anchors. Carousel `cf2d1834-26e9-428f-be68-c6dbe0925a8a` has six rendered 1080×1350 JPEG slides, per-asset hashes and alt descriptions, caption, source ledger, measured template contrast of at least 6.45:1, and a local-product CTA. Package: `var/marketing/<carousel-id>/ready-to-publish.zip`; preview: `artifacts/evidence/carousel-contact-sheet.jpg`. Publication remains blocked on F05 and a public HTTPS destination. No post, engagement, or conversion is fabricated. First-party campaign visit/signup/activation measurement is implemented; revenue and cross-device attribution remain unknown.

PostgreSQL verification passed 29 database-backed journeys at the recorded baseline, including a real two-thread race for the last free quota unit. The test exposed a PostgreSQL nullable-join locking incompatibility in verification; the implementation now locks the Challenge row explicitly. Subsequent checks preserve original receipt destinations and retain quota for revoked sends with uncertain provider outcomes. Docker image build completed locally. The production-settings system check has only the intentional HSTS preload notice; local development mode emits the expected secure-cookie/HTTPS notices.

#### Current implementation status (supersedes the initial inspection table)

| IDs | Status | Evidence / remaining scope | Next action / dependency |
| --- | --- | --- | --- |
| P01 | verified | Empty local/remote inspection and architecture decision recorded | Preserve Django implementation |
| P02, P06, P10, P11 | verified | Local/browser and PostgreSQL integration evidence for auth/isolation, exact-version grants, receipts/pauses, atomic metering | Repeat affected smoke journey on configured host |
| P03 | in_progress | Private uploads, immutable versions, inert UTF-8 indexing, preview/export; PDF/DOCX fail closed | Configure ClamAV and verify PDF/DOCX live path; OCR remains unavailable |
| P04 | in_progress | Contact aliases, verified email/phone identities, endpoint revision invalidation, ambiguity handling, channel choice and saved default | No contact import; live SMS activation remains unverified |
| P05 | in_progress | Bounded English find/send/share/email resolver and explicit 15-minute context work | General semantic conversation/history queries remain incomplete |
| P07–P08 | in_progress | Default native delivery, received-file downloads, channel-bound grants, stable operation IDs, Resend and optional Twilio adapters; fixture/HTTP checks protect delivery and uncertainty | Native workflow verified locally. Hosted/live account smoke needs F01/F03; optional live SMS needs F14 |
| P09 | verified | Partial exact-version requests and matching account/endpoint identity work; native requests honor the granted delivery channel | Repeat on configured host; external channels need their provider setup |
| P12 | in_progress | Checkout/portal and verified subscription lifecycle implemented and tested with fixtures | F06; complete refund and settled revenue reconciliation before paid launch |
| P13 | in_progress | Per-file original export, metadata export, document-byte/text deletion, permission/privacy disclosures | Account deletion, retention expiry and backup erasure remain incomplete; F08 |
| P14 | deferred | No local-folder, messaging, voice or Vexo integration claimed | F11, after core live workflow |
| A01 | in_progress | Durable database jobs/events, deduplication, leases, retries, safe failure codes and local worker launcher | Verify supervised hosted restart/recovery |
| A02 | blocked | Documented Naïve adapter exists; no provider session | F02 credentials, scoped agent and budget |
| A03 | verified | Consent-based in-app public/private feedback intake; conditional subreddit invitation | F04 needed for real subreddit link |
| A04 | blocked | Reddit automation deliberately disabled pending commercial approval; no actual app listings exist | F04 approval and supported connector implementation |
| A05 | in_progress | Deterministic clustering, existing-function checks, priorities and content-only acceptance specs | Validate choices on genuine attendee feedback; F09 |
| A06–A07 | verified | A fixture generated a content-only commit in an isolated Git worktree and passed the fixed application suite in an immutable Docker container with no network or customer mounts; see `artifacts/evidence/isolated-company-build.json` | Live Naïve execution and hosted release still require F02/F10 |
| A08 | blocked | Trusted PR/release controller and disabled deployment/rollback templates exist | F01/F10 host, environment, protected checks, constrained credentials; hosted rollback unverified |
| A09 | in_progress | Deduplicated requester notifications, truthful blocked-state notices and aggregate help-use events | A real verified release is required for shipped notification evidence |
| A10–A11 | verified | Primary-source fetch/hash/anchors; six slides, caption, alt descriptions, layout checks and final CTA rendered and inspected | Re-render CTA after public domain activation |
| A12 | blocked | Facebook Login publishing/reconciliation/insights adapter implemented, inactive | F05 authorization, current API version and public media/destination; live API behavior unverified |
| A13 | in_progress | First-party campaign visits/signup/activation aggregates and explicit attribution limits | Observe a genuine authorized campaign; revenue attribution remains unknown |
| A14 | in_progress | Private support intake, scoped routine guidance and escalation to operator | Broader autonomous support and refund policy remain incomplete |
| A15 | in_progress | Durable queue monitoring, incidents, cost reservations and operational runbook | Provider invoice reconciliation, encrypted backups/restore and sustained health monitoring remain incomplete |
| A16 | in_progress | Staff dashboard, actual records/modes, pause, founder queue, attempts and spend caps | Populate live evidence and configure production role/DB/volume separation |
| A17 | in_progress | Local supervised launcher, event jobs and opt-in daily marketing/measurement schedules | No deployed cloud worker or schedule exists; F01/F10 |
| V01–V05 | verified | Database journeys exercise tenancy, recipient/grant failures, inert injections, idempotency/quotas/provider uncertainty and billing lifecycle | Live external-provider smoke evidence remains blocked |
| V06–V08 | in_progress | Scope/claim/pause/retry checks exist; protected baseline and Docker isolation implemented | Complete immutable sandbox fixture run; hosted restart/rollback and live permissions remain unverified |
| V09 | blocked | Fixtures are labeled; no attendee feedback is represented as genuine | F09 and real protected release/delivery |
| V10 | in_progress | README, env example, deployment/operations/economics docs and honest adapter states exist | Finish public-launch blockers before activation |

External spend in this implementation session: no paid provider action observed. Docker and test operations used local resources; provider research was read-only. No live revenue exists. Founder actions F01–F10 remain blocked on the account/control decisions described in §16; F11 is deferred. Independent sandbox execution and responsive inspection are now complete. The next unblocked task is GitHub development checks/delivery and final evidence reconciliation. A further cross-mode guard prevents locally verified fixture identities from authorizing real-provider sends. GitHub Actions passed 30 PostgreSQL journeys including that regression on revision `4e388e54ebecebec418b844eff81e8a993bb801e`. A subsequent deletion regression check confirms that removing original bytes frees storage allowance while retaining minimal audit metadata.

### Milestone 3: independent build evidence and development delivery

The actual fixture feedback → triage → isolated content patch → independent verification path completed. Work `53c78c95-7a7b-4bd9-b220-8efb08afe3d1` produced local commit `a90a4021a1d5cf4d4d62e879f03c47489416a06d` against baseline `a640010024d49b3829cc568d579b039ce8c15874`. Immutable verifier image `sha256:2cd35d3b27ba2fce00bcb8d8f6cde39c055fb57c512bf7c710cc1a8de01fb7b3` passed the 29-journey suite with SQLite's single PostgreSQL-only concurrency test skipped. That concurrency check separately passed on PostgreSQL. No customer volumes, host home, production secrets, or network were available to the verifier. Evidence: `artifacts/evidence/isolated-company-build.json`.

The trusted release controller rejected the fixture with `fixture_release_forbidden`. No live PR, publication, customer message, or deployment was created from synthetic demand. Genuine attendee milestone M3 remains blocked. The implementation PR is [#1](https://github.com/mehmetuzgoren/fyde/pull/1), targeting dev. Initial CI exposed a service-container quoting error before tests could run; that configuration is corrected. The original HTTPS OAuth push lacked workflow scope; the existing authorized SSH identity successfully pushed the workflows without changing credentials or access controls.

Browser QA exercised the complete local send/download workflow and inspected both 1280-pixel desktop and 375-pixel mobile layouts. The mobile document width matched its viewport. The carousel page shows the actual source ledger, full package, blocked publication, unknown post ID and unknown performance. Screenshots are in `artifacts/evidence/`. There is no hosted deployment and no main promotion.

### Final verified delivery gates, November 7, 2026

[GitHub Actions](https://github.com/mehmetuzgoren/fyde/actions/runs/42424956553) passed all **32 PostgreSQL integration journeys**, lint, migration-drift and application checks on revision `86dd1027e8457fa5f3c546700ad499729b726ed8`. Both required checks, `integration` and `release-boundary`, passed. The new checks cover fixture-to-live identity rejection, deletion/storage accounting, and exclusion of synthetic jobs from live autonomy metrics. This is source/integration evidence, not proof of a deployed service.

GitHub dev protection is active: strict current-head checks, admin enforcement, linear history, and no force pushes or branch deletion. [PR #1](https://github.com/mehmetuzgoren/fyde/pull/1) is the authoritative development delivery record. No production/main merge is authorized. The hosted deployment job is intentionally disabled until the hosting environment and constrained credentials exist. A local synthetic candidate worktree is retained under `var/company-work` solely for its isolated-build evidence; it is not attendee work and cannot release live. The implementation chat's feature worktree was submitted for recoverable retirement after GitHub confirmed the dev merge; Codex primary-checkout protection blocked it, as recorded below.

The complete available result is a locally usable file-sharing application, database-backed company workflows with a verified isolated fixture build, configurable plans/billing integration, and an actual source-backed carousel package. The next highest-priority external step is F03 plus F01: authorize a verified sender and budget, configure public HTTPS hosting, and complete one real email/recipient-access smoke journey. Then F02/F10 and F09 enable a genuine attendee feedback-to-release cycle; F05 enables the authorized Instagram publication. Broad semantic conversation, Reddit ingestion, full account deletion/backup erasure, refund/revenue reconciliation, and sustained hosted rollback remain incomplete, as recorded above.

### Development merge and retained checkout

[PR #1](https://github.com/mehmetuzgoren/fyde/pull/1) is confirmed **merged into GitHub dev**. The verified feature head is `f6da1bb414fa2869445477d7539009a44ad40021`; the dev merge is `f004e482527bda7d3bd5c2803dd382c0deea81cd`. [Post-merge verification](https://github.com/mehmetuzgoren/fyde/actions/runs/42425223214) passed. The [development deployment workflow](https://github.com/mehmetuzgoren/fyde/actions/runs/42425269780) was **skipped** because hosting activation is disabled; GitHub has no deployment record. This is a code delivery, with no hosted service, real provider send, payment, Instagram post, or genuine attendee release claimed.

Local runtime data and generated marketing assets were preserved in the original workspace, `/Users/mehmetuzgoren/Desktop/Life/Side Projects/fyde`. The local preview and worker launcher run from that retained workspace. The supplied Downloads tracker is synchronized. The synthetic candidate remains under its ignored `var/company-work` directory as verification evidence and cannot release live.

Recoverable worktree archival was attempted immediately after the GitHub merge. Codex returned **“The task's primary checkout cannot be removed.”** The protected checkout remains untouched at `/Users/mehmetuzgoren/.codex/worktrees/fyde-implementation/fyde`; archive is blocked, not complete. No forced removal or chat closure was attempted. App/operator action is needed before that protected designation can permit archival.

No production/main promotion occurred. The next product milestone remains F01/F03: configure public HTTPS hosting and a verified email sender with explicit cost/count budgets, then verify a real send and recipient access. Genuine feedback-to-release and live publishing remain blocked on the founder actions already recorded.

### Direction update: Fyde delivery is the default

Founder direction: deliver shared files inside Fyde by default, with optional email or phone delivery, and make received files downloadable in the app. This supersedes the earlier email-first delivery decision.

Baseline: the current transfer controller always queues email, grants are email-only, and there is no recipient inbox. Existing email sending, permissions, immutable-version bindings and quota safeguards must remain working.

Status: `implemented and merged into dev; locally verified`. The authenticated Received page, native delivery without an external provider, per-send/default channel selection and optional SMS-link adapter are implemented. Preserve exact-recipient verification for each channel, revocation/expiry at download, fixture/live separation and one charge per file-recipient transfer. Phone delivery means SMS links; it is not iMessage. Existing accounts and email delivery must continue working.

Evidence: 19 existing exchange integration journeys pass. Nine new receiving journeys pass, protecting the native default, exact original bytes, wrong-account denial, verification/mode boundaries, pause/expiry/revocation/hash checks, quota deduplication, notification failure, linked phones, standing requests, legacy email bindings and mocked Twilio acceptance/uncertainty. These are local fixtures and mocked HTTP responses. All 41 database-backed journeys passed on PostgreSQL, including real row-lock concurrency. The native browser journey completed sender command → received-file inbox → original-file download for transfer `95b0d7a1-a6f2-44c0-8061-e8dc0a83069e`. The downloaded SHA-256 is `90281af4750128e05e1e2667692b215ddaed30d6c15fdace66d7aa7d788ccdc3`, matching the uploaded fixture. Desktop (1280×900) and phone-sized (390×844) UI inspection passed; the narrow layout has a 390 px content width and viewport. Screenshots: `artifacts/evidence/received-desktop.png`, `artifacts/evidence/received-mobile.png`. The actual existing database upgrade retained its legacy email transfer and valid version-1 binding. Implementation is confirmed merged into protected `dev` in [PR #3](https://github.com/mehmetuzgoren/fyde/pull/3). The final feature head is `67c0150f4cec846c56189bff36480df77a7141d9`; the dev merge is `96da91a617f8c30736025b14bc87f429f052e2c7`. Both required checks passed on that head. [Post-merge PostgreSQL verification](https://github.com/mehmetuzgoren/fyde/actions/runs/42428382967) passed all 41 journeys, including native delivery and queued-email races for the last quota unit. The [development deployment workflow](https://github.com/mehmetuzgoren/fyde/actions/runs/42428442641) was skipped because hosting activation is disabled. No hosted service or main promotion is claimed. External email/SMS activation still requires authorized credentials and budgets. Native delivery between already verified accounts calls neither provider. New live account email verification still needs the email service. No live SMS/email was sent. Company settings explicitly disable SMS and clear Twilio credentials, verified in a separate process with fixture sentinel values. Broader company, hosting and marketing blockers above remain unchanged.

The original local app at `http://127.0.0.1:8000` was upgraded to the merged revision after consistent backups of both local databases under ignored `var/pre-inbox-upgrade/`. Migration 0004 applied to both databases; the existing legacy email transfer still has its valid original binding. A separate labeled fixture sender/recipient pair and a native handoff are available for review; their local-only credentials are in `var/native-demo-login.txt` in the original repository. A backend smoke against that receiving account downloaded the exact hash, retained one consumed unit and created no external notification. The web service and durable workers are running from the original repository. The temporary preview on port 8001 and this task’s PostgreSQL test container were stopped.

The implementation checkout has no uncommitted feature work after the dev merge. Codex previously rejected recoverable archival for this exact checkout with “The task’s primary checkout cannot be removed.” That workspace protection still applies; the checkout was retained, with no shell deletion or protection bypass. The existing independent company fixture worktree remains untouched. Optional SMS activation is also listed as F14 in the actual founder-action dashboard, with no credentials assigned to business agents.

### Product and delivery

- [x] P01 — Inspect existing implementation, preserve working stack, and record architecture decisions.
- [x] P02 — Implement and verify authentication, tenant isolation, and per-object authorization.
- [ ] P03 — Private upload, safe extraction/quarantine, immutable versions, preview, and searchable indexing.
- [ ] P04 — Contacts, endpoint verification, aliases, preferred channels, and ambiguity handling.
- [ ] P05 — Natural-language search and structured transfer intent.
- [x] P06 — One-time grants, standing grants, expiry, revocation, and readable permissions UI.
- [ ] P07 — Trusted transfer controller, execution binding, idempotency, and uncertain-outcome reconciliation.
- [ ] P08 — Real email adapter and verified recipient-bound download flow.
- [x] P09 — Authenticated incoming requests, partial fulfillment, and private failure handling.
- [x] P10 — Receipts, accurate statuses, transfer history, and global/per-contact pause.
- [x] P11 — Atomic quota reservations, usage ledger, reset periods, and plan configuration.
- [ ] P12 — Billing checkout, verified webhooks, portal, lifecycle tests, and reconciliation.
- [ ] P13 — Export/deletion/retention behavior and clear privacy/permission disclosures.
- [ ] P14 — Optional local-folder, messaging, voice, and Vexo adapters, each independently verified.

### Autonomous business

- [ ] A01 — Durable jobs/events, retry limits, deduplication, trace IDs, and restart recovery.
- [ ] A02 — Naïve credentials, actual role sessions, scoped tools, and provider cost/session evidence.
- [x] A03 — First-party feedback intake and subreddit review invitation.
- [ ] A04 — Approved Reddit/review connector with consent, provenance, deletion handling, and rate limits.
- [ ] A05 — Feedback clustering, triage, prioritization, and bounded work specifications.
- [x] A06 — Isolated builder with synthetic data and no production credentials.
- [x] A07 — Independent baseline tests, protected-path enforcement, and release eligibility checks.
- [ ] A08 — Real preview, trusted deployment, feature flags, regression monitoring, and rollback.
- [ ] A09 — Requester notifications and post-release usage measurement.
- [x] A10 — Source research, structured claim ledger, and factual verification for marketing.
- [x] A11 — Deterministic carousel renderer, mobile-quality checks, captions, and final-slide CTA.
- [ ] A12 — Instagram authorization, supported publishing adapter, deduplication, and publish evidence.
- [ ] A13 — Campaign attribution and observed activation/retention/conversion reporting.
- [ ] A14 — Routine support agent, authorized diagnostics, escalation, and notification preferences.
- [ ] A15 — Provider health, incident handling, backup/recovery verification, and cost reconciliation.
- [ ] A16 — Operator dashboard, global kill switch, authority boundaries, and budget enforcement.
- [ ] A17 — Scheduled/event-driven operating loop with no hidden human steps.

### Verification and launch

- [x] V01 — Cross-tenant search, excerpt, download, and transfer access tests.
- [x] V02 — Wrong/ambiguous recipient, spoofed request, endpoint-change, expiry, and revoked-grant tests.
- [x] V03 — Document/review/web-page prompt-injection and private-data exfiltration tests.
- [x] V04 — Duplicate webhook/job, concurrency/quota, retry, and provider-timeout tests.
- [x] V05 — Billing renewal, downgrade, cancellation, failed payment, and out-of-order event tests.
- [ ] V06 — Builder cannot alter authority/CI or read production data; trusted release baseline remains intact.
- [ ] V07 — Marketing fails closed on unsupported claims, missing permissions, and duplicate publication.
- [ ] V08 — Budget exhaustion, provider outage, global pause, restart recovery, and rollback tests.
- [ ] V09 — Genuine attendee feedback, consent-safe sample files, and an evidence-linked closed business loop.
- [ ] V10 — Production activation checklist, documented limits, and honest live/demo labels.

## 16. Founder-action register

These are external authority/account decisions, not requests to describe the codebase. The agent should identify which are already satisfied, prepare exact instructions for the rest, and continue on unblocked work. Do not create accounts, spend money, publish, or charge customers beyond the configured authorization.

| ID | Action requiring founder/external authority | Dependency / done evidence | Initial status |
| --- | --- | --- | --- |
| F01 | Confirm name/domain and public support identity | Chosen settings and DNS/account control | blocked |
| F02 | Authorize Naïve and other paid providers; set spending caps | Secret references, limits, successful scoped test | blocked |
| F03 | Authorize sending domain/mailbox and required email configuration | Verified sender and successful real send | blocked |
| F14 | Optional: authorize Twilio SMS sender and destination registrations; set segment-cost, daily USD and message-count caps | Set SMS_ADAPTER=twilio, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SMS_FROM, HTTPS SITE_URL, SMS_UNIT_COST_USD, SMS_DAILY_BUDGET_USD and SMS_DAILY_LIMIT in the customer worker secret store; complete a consent-safe verification/send/download smoke | blocked; native delivery is independent |
| F04 | Create/identify product subreddit and obtain approved commercial API use | Approved use case and scoped credentials; own form works meanwhile | blocked |
| F05 | Connect the Instagram professional account and publishing permissions | Valid account authorization and successful permitted publish | blocked |
| F06 | Activate payment account and approve live billing | Operator activation; verified prices, terms, webhook, portal | blocked |
| F07 | Approve pricing experiment and published storage/size/bandwidth/fair-use terms | Versioned plan policy; no hidden unlimited cap | blocked |
| F08 | Approve privacy/retention, support/refund policy, and necessary legal/account obligations | Published accurate policies and tested controls | blocked |
| F09 | Invite attendees and collect voluntary real feedback | Attributed genuine feedback, with private data excluded | blocked |
| F10 | Approve autonomous release boundaries, posting cadence, and emergency contact | Versioned operator policy outside builder control | blocked |
| F11 | Obtain optional local-device/Vexo access | Verified documented interface and explicit permissions | deferred |

Company formation, account verification, contractual approvals, disputed payments, incidents requiring accountable judgment, and changes to delegated authority may still require a person. Track these honestly. “Fully automated” means routine work inside an approved operating boundary, not the absence of a responsible owner.

## 17. Working logs to maintain

### Decision log

| Date | Decision | Basis | Reversible? | Owner |
| --- | --- | --- | --- | --- |
| 2026-11-07 | Broad contact-to-contact file exchange, not a profession-specific app | Founder direction | Yes | Founder |
| 2026-11-07 | Reddit preferred; first-party feedback as operational fallback | Founder direction plus access dependency | Yes | Founder / product agent |
| 2026-11-07 | Educational adjacent-topic carousels with final-slide CTA | Founder direction | Yes | Founder / growth agent |
| 2026-11-07 | Deliver in Fyde by default; optional email/SMS links and received-file downloads | Founder follow-up | Yes | Founder |
| 2026-11-07 | Treat $0 / $5 / $20 tiers as a configurable experiment | Founder direction; economics unvalidated | Yes | Founder |

### Build-session update template

```text
Date / session / agent:
Work-item IDs:
What changed:
Evidence (tests, commit, deployment, provider receipt):
Data mode (live / sandbox / fixture / manual):
Autonomous actions and human interventions:
Costs incurred / remaining budget:
Blocked dependencies and exact owner action:
Next highest-priority unblocked task:
```

### Initial execution instruction

Start with repository inspection, fill in actual statuses, and build the highest-priority missing piece of the real file-sharing vertical slice. Then complete one evidence-linked autonomous improvement loop and one source-backed growth artifact. Add channels and agents only after the existing path works. Keep this document synchronized with implementation and remaining founder actions.

## 18. External references and integration checkpoints

Sources checked November 7, 2026. These support the stated external requirements; the proposed architecture, quotas, workflow design, and milestones are product decisions, not claims made by these sources. Recheck live documentation when implementing an API. No exact SDK signatures, pricing, platform quotas, or Vexo endpoints are promised by this specification.

- **[S1] Hackathon brief:** https://usenaive.ai/hackathon — End-to-end autonomous-company goal and live-demo format. Event listing: https://events.ycombinator.com/naive-autonomous-companies-hackathon (listing text was not extractable during this review).
- **[S2] Naïve documentation:** https://usenaive.ai/docs — Platform overview. Documentation index: https://usenaive.ai/docs/llms.txt
- **[S3] Naïve budgets:** https://usenaive.ai/docs/concepts/budgets — Per-agent/task/session spending controls; verify exact current semantics.
- **[S4] Naïve tool policies:** https://usenaive.ai/docs/concepts/policies — Tool-level permission controls, including per-agent configuration.
- **[S5] Naïve teams:** https://usenaive.ai/docs/capabilities/team — Coordinator, specialists, version pinning, and shared work state.
- **[S6] Stripe subscription events:** https://docs.stripe.com/billing/subscriptions/webhooks — Asynchronous subscription state and verified webhook handling.
- **[S7] Apple Automation permissions:** https://support.apple.com/en-au/guide/mac-help/mchl07817563/mac — User-controlled permission for apps to control other apps; not a guarantee of an iMessage sending API.
- **[S8] Apple Messages file collaboration:** https://support.apple.com/en-mk/guide/messages/icht99c91ba3/mac — User-facing sharing from Messages on Mac; unattended integration remains a separate implementation question.
- **[S9] Reddit Responsible Builder Policy:** https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy — API/commercial approval, automation transparency, and prohibited activities. Related access overview: https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data
- **[S10] Meta's official Instagram API collection:** https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api — Professional-account access and separate login/permission paths. Recheck the current content-publishing reference for carousel endpoints and media limits; the developers.facebook.com publishing pages were rate-limited/unavailable during this review.
