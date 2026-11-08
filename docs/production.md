# Production hosting and the mobile API

The production website and mobile API share `https://fyde.izbirakin.com`. Cloudflare serves the web app and forwards authenticated requests to Neon Functions. Set the mobile client's `EXPO_PUBLIC_API_URL` to that origin, without `/api/v1` or a trailing path. The customer endpoints start at `/api/v1/`; recipient agents use `/api/agents/v1/`. Native clients sign in and send their device token in `Authorization: Bearer …`. They never receive the private proxy key or database/storage credentials.

The Cloudflare custom domain uses managed DNS and TLS and is attached to the production `fyde` Worker in Cloudflare. Domain management stays separate from the Worker-only deployment token; releases preserve the existing binding. `https://fyde.mehmetuzgoren.workers.dev` remains an alias for the same app and backend. Both exact origins are allowed by the API and Neon Auth. Browser sessions are specific to each hostname; sign in again when switching between them.

Production has its own Neon project, `fyde-prod` (`patient-cherry-39934916`, branch `br-dry-dust-bez1dfpd`, AWS Ohio), private `uploads` bucket, Managed Better Auth service and runtime credentials. It starts empty. Development accounts and files stay in `fyde-dev`. Create and verify a production account through the website before signing into an older mobile build that lacks the verification-code screen.

## Mobile connection

The checked-in native release fallback and the EAS `preview` and `production` profiles use the production origin. A local device build can select it with an ignored `mobile/client/.env.local`:

```dotenv
EXPO_PUBLIC_API_URL=https://fyde.izbirakin.com
```

Reload the app after changing public build configuration. A previously installed release needs a new bundle/build to adopt a changed origin; server deployment alone does not change an installed binary. Web builds use the current page origin. `EXPO_PUBLIC_*` settings are public and must contain no secrets. This hosting release does not submit an app to either store or activate a paid EAS build.

## Releases

`dev` continues to deploy the development website. A reviewed promotion PR from `dev` to `main` releases production. `main` requires the existing integration, release-boundary and TypeScript checks. After those checks and the mobile build pass, the same push run calls `Deploy approved production revision` when `PRODUCTION_DEPLOY_ENABLED=true`. The reusable deployment inherits the main ref, so the main-only environment rule still applies when the repository's default branch is dev.

The `production` GitHub environment accepts `main` only. It stores a Neon deployment key limited to `fyde-prod` and a Cloudflare Individual Workers Editor token limited to `fyde`. Application secrets stay on their respective hosts. The migration owner's connection remains in a private local file and is absent from the deployed functions and GitHub deployment secrets.

The production job checks that the verified commit is still `main`, deploys `fydeapi` and `fydejobs` to the production Neon branch, downloads that CI run's verified web artifact, and deploys `wrangler --env production`. It then requires `/health/` to report the exact Git SHA and checks the public pages. Do not run an additional manual release while this automatic path is active. Hosting logs omit document contents and redact callback query strings.

`backend/src/migrate.ts` bootstrapped the empty production database from the committed SQL baseline. The runtime uses the pooled `fyde_customer_app` connection, with read/write access to application tables and no access to `neon_auth`. Schema changes require a reviewed migration; deployment does not run destructive migrations. Production retains seven days of Postgres history. That history does not establish a recoverable backup of object storage; verify an object-backup and restore procedure before relying on the service for important originals.

## Authentication and current capabilities

Production requires email verification by code, revokes provider sessions on password reset, uses the application name Fyde, allows the exact production origin and disables localhost access at the provider. Browser sessions use HttpOnly cookies; native sessions use the device bearer protocol. Development's shared Google configuration does not carry into production. Google remains hidden until an application-owned OAuth client is configured and `FYDE_GOOGLE_AUTH_ENABLED=true` is set on both production functions. Email verification currently uses Neon's shared sender; an application-owned SMTP provider remains a launch task. See [Neon's authentication guidance](https://neon.com/docs/auth/production-checklist).

The running customer app supports private text uploads, exact-byte downloads, explicit versions, keyword search, in-app sharing, case permissions, scoped recipient agents, receipts and revocation. The scheduled processor validates uploads and retries deletion. PDF/DOCX release still needs malware scanning and bounded extraction. Semantic inference, external email/SMS file notifications, paid checkout and the separate Python company workers are not activated by this release.

## Evidence

Production acceptance records the final deployment run, hosted `/health/` revision, provider settings, private-storage hash probe, anonymous access denial, a real scheduled-function invocation and any completed browser/device journey. Mocked integration tests and successful bundles remain separate from live acceptance. A health response alone does not establish physical-device, Android-package, app-store or paid-provider readiness.
