# Cloudflare and Neon development hosting

The customer app uses the Expo React Native web export on Cloudflare Workers Static Assets. A small Worker forwards API and Google callback requests to the TypeScript Hono API on Neon Functions. The browser uses one origin: `https://fyde-dev.mehmetuzgoren.workers.dev`.

The API uses the existing customer Postgres tables, private `uploads` bucket and Managed Better Auth in `fyde-dev` (`plain-moon-84345799`, branch `br-little-glitter-beqgxchi`, AWS Ohio). A second Neon Function processes quarantined uploads and retries file deletion on a one-minute schedule. The separate company database is outside this runtime.

## Files, identities and permissions

Original bytes stay private in Neon Object Storage. Postgres holds ownership, hashes, explicit versions, searchable text, contacts, grants, receipts and quota records. Download routes authenticate the caller, recheck the exact grant and verify the bytes against the stored hash. Files never become public bucket objects.

Email/password and Google sign-in use the existing Neon Auth service. Fyde keeps the encrypted provider cookie in Postgres, checks the live provider session on protected customer requests and binds ownership to the stable Neon subject. The existing encryption key, account IDs, stored files and transfer bindings remain compatible. The web session is an HttpOnly, Secure, SameSite=Lax cookie. Mutations using that cookie require the exact allowed Origin. Native clients and recipient agents retain their separate bearer protocols. Google exchange codes use state, S256 and one-use redemption.

The Cloudflare Worker adds a private origin key before forwarding requests. The API checks it before parsing a body or touching Postgres. Consumers still authenticate as their own user or scoped agent. Requests directly to the native Neon URL cannot obtain access without the origin key. The scheduled processor separately accepts Neon trigger provenance or its private operations key.

Text uploads pass bounded UTF-8 validation before indexing. PDF and DOCX uploads remain quarantined in this development configuration: a connected malware scanner and bounded extraction are still required before those formats can be shared. Deleting a document hides it and revokes access immediately; a durable retry removes provider bytes after an outage. Downloaded copies cannot be recalled.

## Configuration and credentials

`backend/neon.ts` declares `fydeapi`, `fydejobs` and the scheduled trigger. It does not replace existing Auth or bucket configuration. Initial deployment loads a private local environment; subsequent code deployments preserve keys omitted from the config evaluation.

| Location | Configuration |
| --- | --- |
| Neon Functions | Restricted `FYDE_DATABASE_URL`, stable `FYDE_SESSION_SECRET`, `FYDE_STORAGE_KEY_ID`, `FYDE_STORAGE_SECRET`, S3 endpoint, `FYDE_EDGE_KEY`, `FYDE_JOB_KEY`, `SITE_URL` |
| Cloudflare Worker | Public `FYDE_API_URL` and secret `FYDE_EDGE_KEY` |
| GitHub `development` environment | Project-scoped `NEON_API_KEY` and Cloudflare deployment token |
| Frontend | Public API origin only; web requests use the current page origin |

Neon injects `NEON_AUTH_BASE_URL`. The runtime selects the restricted database role instead of the automatically injected owner connection. Migration owner credentials stay outside the deployed app. Cloudflare receives no database, provider-session or object-storage credentials. Query strings are redacted from Cloudflare observability, and invocation logs are disabled to avoid retaining authentication callback URLs.

Keep private local files under an ignored directory with directory mode 0700 and file mode 0600. Never place secrets in `EXPO_PUBLIC_*`, source, build artifacts or workflow output. Replacing the session secret invalidates decryption of existing provider sessions.

## Local development and checks

Use Node.js 24 and the committed lockfiles:

```sh
npm ci --prefix backend
npm ci --prefix cloudflare
npm ci --prefix mobile/client
npm --prefix backend run typecheck
npm --prefix backend run build
npm --prefix mobile/client run typecheck
npm --prefix mobile/client run lint
npm --prefix mobile/client run bundle:web
npm --prefix cloudflare run typecheck
npm --prefix cloudflare run check
```

Run the integration journeys against a disposable local PostgreSQL database whose name ends in `_test`. The suite truncates its fixture records. Never point it at the hosted customer database.

```sh
MIGRATION_DATABASE_URL=postgresql://fyde:fixture-only@127.0.0.1:6543/fyde_ts_test npm --prefix backend run migrate
FYDE_INTEGRATION_DATABASE_URL=postgresql://fyde:fixture-only@127.0.0.1:6543/fyde_ts_test npm --prefix backend run test:integration
```

The six journeys cover provider revocation, tenant isolation, private bytes, idempotency, exact-version permissions, case agents, concurrent quota consumption, deletion retries and Google exchange. They use real PostgreSQL with mocked Auth and object storage. Separate compatibility checks used the actual existing encrypted session, transfer and synthetic Neon object. Hosted acceptance must exercise the deployed functions and browser separately.

For a private local API preview, load the runtime environment without printing it, set the exact local `SITE_URL`, and run `npm --prefix backend run dev` on port 8020. The Cloudflare preview runs on 8030 and needs matching local backend URL and origin key. Register any local Google callback origin in Neon Auth before using it. Generated Worker bindings come from `npm --prefix cloudflare run types`.

## Development delivery

GitHub's `Verify application` workflow retains the existing Python integration, mobile and release-boundary checks and adds TypeScript integration and Cloudflare packaging. A successful push build on `dev` triggers `Deploy approved development revision` when `DEVELOPMENT_DEPLOY_ENABLED=true`. The deployment environment accepts the `dev` branch only. PR workflows cannot obtain its deployment secrets.

The deployment job confirms the verified commit is still the current `dev` revision, builds and deploys the Neon functions, downloads that run's verified website artifact, deploys Cloudflare and checks `/health/` against the exact Git SHA. It also requests the public help, privacy and pricing pages. Do not run an additional manual deployment while this automatic path is enabled. An unsuccessful job remains a failed deployment and needs repair before release.

No destructive migration runs during deployment. `backend/src/migrate.ts` can bootstrap an empty customer database from the committed SQL baseline or check an already migrated database without replacing its rows. Future schema changes need a separate reviewed migration. Rolling code back does not roll back stored data or objects; retain the last verified revision and compatibility evidence.

The native client defaults to the hosted origin for release builds. Existing installed clients need a build configured for this origin. A successful web deployment does not establish physical-device, Android-package or store acceptance.

## Features outside this deployment

In-app sharing, case-agent requests, receipts, metadata export and first-party feedback run on the new customer API. External email/SMS file notifications and paid checkout remain disconnected. The separate company dashboard, company workers, marketing pipeline and autonomous release controller remain in the Python source and are not hosted by these functions. The concurrent semantic-search change is preserved in the repository and database; the TypeScript search endpoint returns scoped keyword results and excerpts with `semantic_status=disabled`. Connecting the private Google inference service to the new host still needs its own server identity. The local Django fixture app and its existing tests remain available for that work.

The development environment stays separate from the [production website and mobile API](production.md). Production uses its own project and credentials, with releases promoted from `dev` to `main`. Its remaining provider and file-format limits are recorded in that runbook.
