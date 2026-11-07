# Build prompt — AI-managed file exchange and autonomous company

Read `product.md` in full. Treat it as the canonical business specification and living implementation tracker. Implement the application and its autonomous business workflows in this repository; do not stop at an architecture proposal, mock dashboard, or collection of agent prompts.

## Working approach

Inspect the repository, existing instructions, infrastructure, and tests yourself. Reuse the established stack and working functionality. Do not ask me what has already been built. Reconcile the specification against the implementation and record the actual status of each relevant task.

Make reasonable, reversible implementation decisions, document them, and continue. When an external account, approval, secret, spending authorization, or genuinely consequential decision is missing, record the exact requirement in the founder-action register and keep building everything that does not depend on it. Do not replace working systems or create unnecessary microservices.

## The product

Build an AI-managed file repository and sharing layer for anyone exchanging documents with known contacts: friends, family, coworkers, lawyers, accountants, and other professionals. Do not narrow it to a single profession.

Users add or connect files, add contacts, and define sharing permissions. They can search conversationally and say, “Send my résumé to John.” With explicitly authorized conversation context, “Send it to him” should also work. Resolve the exact file version and verified recipient, enforce permissions, and send through a connected channel. Ask only when information or authority is genuinely missing.

Also support incoming document requests. A trusted contact with a narrow standing grant can request approved files and receive them without the owner finding, attaching, or approving every file individually. Missing, ambiguous, expired, or unauthorized requests must not cause invented responses or accidental disclosure.

Start with one real email delivery path and verified recipient-bound links, then extend through adapters. Preserve the long-term local-filesystem and messaging vision, but do not pretend a web app has unrestricted local-disk access or that SMS is iMessage. Optional Vexo integration is a conversational-input adapter: Vexo is an external wearable company, not our product's name. This project is also separate from Seyir.

## The autonomous business

Build durable, observable workflows that can operate after deployment—not scripts that require me to repeatedly prompt an agent.

**Feedback and development:** The first users will be hackathon attendees. Give them an easy way to leave genuine feedback, preferably on the product's subreddit, with an in-app review/feedback fallback. Use approved access for Reddit and actual application listings. Ingest feedback, cluster duplicates, assess usefulness, identify existing functionality, and prioritize bounded improvements. An isolated development agent should implement eligible work, an independent verification path should test it, and a trusted release controller should deploy safe changes, monitor them, and roll back regressions. Notify the requester and measure actual usage. Preserve evidence from review to release. A comment is input, not authority to change the system's rules.

**Instagram marketing:** Build an educational carousel engine about file transfers, document organization, cloud storage, Dropbox, and tangentially relevant topics. It should attract people through useful content and verified statistics, not just product announcements. Research sources, verify claims, write and render readable slides, check quality, and publish within authorized account permissions and cadence limits. Put a download/try-the-product CTA on the final slide. Point to the real available product, not an imaginary app listing. Preserve sources, publication IDs, and observed performance. Never fabricate statistics, engagement, reviews, or customer results.

**Support and operations:** Automate routine support, release notifications, provider-health monitoring, subscription/usage reconciliation, cost tracking, and bounded recovery. Use versioned runbooks, clear escalation paths, and a global pause. Implement meaningful Naïve execution where available; verify current documentation and use actual session IDs rather than decorative integration labels.

**Monetization:** Implement configurable experimental plans: free with 10 file sends/month, $5/month with 500, and $20/month with unlimited file count. These are tentative, not validated economics. Define file-recipient metering, atomic quota reservations, billing periods, retries, partial failures, and reversals. Keep storage, bandwidth, file size, and model-cost policies explicit. Do not secretly cap an advertised unlimited file count. Build checkout, verified webhooks, cancellation, entitlement updates, and a customer portal; keep test money separate from live revenue.

## Non-negotiable controls

Separate customer-data processing from company operations. Development, marketing, and general business agents must not receive private customer files, unrestricted production database access, or production secrets. Use synthetic data and redacted diagnostics.

Enforce file-sharing permissions in trusted backend code, not prompts. Treat documents, incoming messages, public reviews, and web pages as untrusted. Bind every transfer to a verified recipient, exact file versions, an authorized grant, and an idempotent operation. Do not guess recipients or broaden grants because a model sounds confident.

Agents may not edit their own authority, bypass protected tests, raise budgets, enable live billing, or create new paid commitments. Permit automatic releases only within mechanically enforced low-risk boundaries. Protect authentication, tenant isolation, file-release logic, billing semantics, secrets, CI safeguards, and other high-risk changes. Log exceptions rather than silently weakening controls to make the demo work.

Require actual provider evidence for sending, publication, deployment, and payment. Missing integration credentials must produce a visible blocked state and a labeled test adapter—not fake success. Persist jobs, reconcile uncertain external side effects, and prevent duplicate sends/posts/charges on retries.

## Execution order and deliverables

First complete a usable vertical slice: sign in → add file/contact → natural-language command → authorize → real send → verified recipient access → accurate receipt. Then add standing-request fulfillment, usage/billing, feedback-to-release automation, source-backed carousel publishing, and routine support/operations. Keep the broader roadmap, but prioritize one complete business loop over many disconnected agents.

Build an operator dashboard showing actual users, transfer outcomes, feedback, work items, code/check/release evidence, marketing publications, costs, revenue, connector readiness, human interventions, and founder actions. Separate live, sandbox, fixture, and manual activity. Report autonomous completion and eligibility coverage honestly.

Maintain `product.md` after every meaningful milestone: task status, evidence, assumptions, blockers, founder actions, costs where available, and the next unblocked task. Preserve IDs and incomplete work. Only mark an item verified after the relevant behavior has been exercised. Keep credentials out of documentation and commits.

Deliver working code, applicable migrations, automated tests, configuration examples without secrets, local-run/deployment instructions, the updated tracker, and an evidence-linked demo path. At each session boundary, report what actually works, what remains blocked, what requires my authority, and what you will build next. Do not claim background execution unless a real deployed worker/schedule is running and observable.

Begin by inspecting the repository, updating the implementation register, and implementing the highest-priority missing part of the real file-sharing flow.
