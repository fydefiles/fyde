# Neon backend

Fyde supports Neon Postgres, private Neon Object Storage, and managed Better Auth. The hosted TypeScript API owns file permissions and delivery. [Cloudflare and Neon hosting](cloudflare-neon.md) describes the current customer runtime; the Django details below document the retained local fixture and compatibility path. Browser sessions and native device credentials are bound to a verified Neon session; Fyde checks that session with Neon before granting access. Recipient-agent credentials remain bound to their explicit case permission.

## Development resources

| Resource | Project | Branch |
| --- | --- | --- |
| Customer Postgres, Auth, private `uploads` bucket | `fyde-dev` (`plain-moon-84345799`) | `br-little-glitter-beqgxchi` |
| Company Postgres | `fyde-company-dev` (`round-mud-61732020`) | `br-late-base-becfhtj4` |

Both projects are in AWS Ohio. Their default Neon branch is named `production`; these projects are development resources and do not represent a production application release. They use the organization's existing Launch plan. Continuous database workers keep compute active, so the application's cost includes compute and host bandwidth as well as object storage.

Auth requires email verification by code. Google uses Neon's shared development credentials. Password resets revoke existing provider sessions. Production needs an approved HTTPS application origin, the application's own Google OAuth credentials, and its email provider. See [Neon's production checklist](https://neon.com/docs/auth/production-checklist) and [Google OAuth setup](https://neon.com/docs/auth/guides/setup-oauth).

## Configure a runtime

Set these variables in a private environment file or the host's secrets manager. `.env.example` lists their names without real values.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Customer runtime database connection |
| `COMPANY_DATABASE_URL` | Independent company runtime database connection |
| `AUTH_PROVIDER=neon` | Require managed sign-in for browsers and native devices |
| `NEON_AUTH_BASE_URL` | This branch's managed Auth URL |
| `FILE_STORAGE=neon` | Store original bytes in Neon |
| `NEON_STORAGE_BUCKET=uploads` | Private bucket |
| `AWS_ENDPOINT_URL_S3` | This branch's storage endpoint |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | Scoped storage credential and region |
| `SITE_URL` | Exact application origin used for auth callbacks |
| `DJANGO_SECRET_KEY` | Stable application secret, also used to encrypt provider-session cookies |
| `CUSTOMER_API_ORIGINS` | Exact web preview origins; native apps use bearer credentials |

The development configuration lives outside the feature checkout at `var/neon-runtime/customer.env` in the primary repository. It is ignored by Git, with mode `0600` inside a `0700` directory. `admin.env` holds migration-owner connections separately. `company.env` contains the company connection and its runtime settings, without customer or storage credentials. Runtime database roles have application-table permissions rather than migration-owner permissions; the customer role has no access to the managed `neon_auth` schema.

Neon mode uses `fyde_neon_session` and `fyde_neon_csrf` cookies so the preview can run beside the original local fixture app on the same hostname without replacing its cookies. Hosts can override `SESSION_COOKIE_NAME` and `CSRF_COOKIE_NAME` when running more instances.

Select the environment explicitly so ordinary local tests continue using local fixtures:

```sh
export FYDE_ENV_FILE="/absolute/path/to/var/neon-runtime/customer.env"
uv run python manage.py check_neon --write-probe
uv run python manage.py runserver 127.0.0.1:8010
```

Run `uv run python manage.py run_delivery` with the same environment in a separate process. It checks and indexes new uploads, retries queued delivery, and removes deleted objects. The company worker must receive only `company.env`; it does not need a customer database connection, Auth cookie, or storage credential.

Use the migration-owner environment only while applying schema changes:

```sh
uv run --env-file /absolute/path/to/var/neon-runtime/admin.env python manage.py migrate --noinput
uv run --env-file /absolute/path/to/var/neon-runtime/admin.env python manage.py migrate --database company --noinput
```

`check_neon --write-probe` uploads synthetic bytes, downloads and checks their hash, checks that anonymous access is denied, and removes its own probe. It prints no credential values. It does not establish a completed user sign-in or an email delivery.

## Sign-in and account linking

The web app provides email/password sign-in, signup, verification codes, password reset, and Google sign-in. Managed authentication calls the branch's REST service. OAuth uses Neon's session-challenge and verifier exchange, following its [server implementation](https://github.com/neondatabase/neon-js/tree/main/packages/auth/src/server). Provider cookies stay encrypted on the Django server. The browser keeps only its normal Django session cookie.

The native app uses the same email/password and verification APIs. Google opens the system auth browser and returns a short-lived, single-use code to `fyde://auth/callback`. Redeeming it requires the initiating device's S256 proof. Native credentials remain in SecureStore and cannot outlive the linked provider session. Web previews use an exact allowed-origin callback and keep their device credential in memory. Adding `expo-web-browser` requires a new native development build before using Google on a previously built binary.

Fyde links an identity by Neon's stable user ID. A previously verified, active live Fyde account with the same verified email can keep its existing user ID and ownership. Fixture accounts and unverified existing accounts require an explicit migration plan. Existing Django password hashes are not imported into Neon, and local password authentication is disabled while `AUTH_PROVIDER=neon`.

## File storage and migration

Every version has a unique opaque object key, size and SHA-256 hash. The application does not issue direct download URLs. It checks recipient authorization and verifies the stored bytes before returning a file. New uploads remain quarantined until the configured scanner and extractor approve them. Remote originals are materialized in bounded private temporary files for parsing and removed afterward. PDF/DOCX safety requirements are unchanged: sharing needs the configured malware scanner.

Deleting a document immediately hides it, removes searchable text and revokes its transfers. Storage deletion runs after the database commit and retries through the delivery worker if the provider is unavailable. The UI reports pending removal rather than claiming that an unavailable provider already removed bytes.

For an existing database whose originals are still on disk, configure the destination credential and preserve the existing metadata IDs. Then run:

```sh
uv run python manage.py copy_files_to_neon
uv run python manage.py copy_files_to_neon --apply
```

The first command validates the local originals without writing remote objects. The second copies missing keys and verifies existing remote keys without overwriting them. Both retain local originals. Switch `FILE_STORAGE` only after every version passes. The newly provisioned development databases start empty; the existing local fixture applications and their files are retained separately.

## Recovery and release boundaries

Neon's S3 versioning and lifecycle configuration are currently not enforced. Fyde therefore keeps explicit versions and performs deletion itself. A Postgres instant restore leaves object storage unchanged; define and verify a separate object-backup procedure before a production launch. Development branches inherit their parent's objects, so previews should start with synthetic data. See [S3 compatibility](https://neon.com/docs/storage/s3-compatibility) and [bucket restore behavior](https://neon.com/docs/storage/buckets).

The current customer deployment uses Cloudflare and Neon Functions; see its [delivery runbook](cloudflare-neon.md). Earlier local Neon evidence alone does not establish hosted acceptance, physical-device Google sign-in, Android behavior or a main-branch production release.
