# Chat, mobile setup and case agents

Fyde opens in chat on the web and in the Expo React Native client. Both use the same private conversation and trusted customer API. The hosted web app uses Neon Functions; the local Django fixture workspace remains at `/app/workspace/`.

## First use

1. Create two accounts: a file owner and a recipient. Verify their email addresses. With the local adapter, use each account's labeled test outbox; no real email is sent.
2. First-use onboarding opens automatically. Create a case, such as “Immigration case,” and choose multiple files. Each file uploads separately, with its own result and safety checks. Native uploads use temporary named File Blobs compatible with Expo fetch and remove those copies after the attempt. Supported formats and plan limits still apply; the app cannot import every local folder automatically.
3. Assign each file to its case and document type. Mark sensitive files explicitly. A filename or relationship label cannot authorize disclosure.
4. Add the recipient's verified email and a relationship label, such as “Lawyer.” This label helps resolve chat instructions. It does not verify professional credentials or create a permission.
5. Review an automatic case permission: recipient, case, document types, channel, expiry and request limit. Future files, future versions and sensitive files are separate choices. Explicitly enable the reviewed scope once.
6. Finish setup. Try `Find my passport`, then `Send it to my lawyer`. The recent-choice option supplies 15-minute context; users can turn it off. Ambiguous files or contacts produce choices.
7. On the recipient account, try `Request passport for Immigration case`. The backend releases only eligible versions under the owner's permission. The owner does not need to be signed in or approve the request again. Received files are downloadable in the app.

The assistant supports bounded English search, sending, requests, relationship updates and permission-review prompts. It does not use a general-purpose external language model. Permission requests in chat open the review flow; they never silently grant access.

The initial permission can cover any supported document type in one explicitly assigned case. It can also cover future files or versions when the owner selects those options. Turning these options off preserves initial version snapshots. Sensitive files remain excluded unless explicitly included. Quarantined, deleted, reassigned and otherwise unauthorized files cannot be released.

Revoke the parent case permission or pause outgoing sharing to stop automatic requests and future downloads. Revoking an individual transfer does not cancel an independently active case permission. Downloaded copies cannot be recalled. To narrow a permission, revoke the old permission before enabling its replacement.

## Run the mobile client

The source is in `mobile/client/`. Chat is the default screen and the center bottom action is an icon-only chat button. The left search icon opens a dedicated page with a search field; Received is on the right. Profile/settings is in the upper-right. Onboarding has no bottom tab. After first use, say `Add files`, `Add a contact`, `Change file details`, `Manage cases` or `Manage permissions` in chat to open a focused review form. A completed account cannot reopen the onboarding route. Contact and case edits are available from those chat forms. Changing a recipient address invalidates existing permissions; it cannot move access to the new recipient. Expo Router owns navigation; React Native supplies the screens and file-picker/export controls. The project uses Expo SDK 58 and generated native projects. Do not edit generated `ios/` or `android/` files.

```sh
cd mobile/client
npm ci
npm run typecheck
npm run lint
npx expo install --check
EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 npm run web -- --host localhost --port 8082
```

This web command inspects the React Native client in a browser. The Cloudflare deployment serves its production web export. Hosted web sessions use an HttpOnly cookie and restore after a refresh; previews against the legacy Django bearer API keep their session in memory. Native device sessions use Expo SecureStore, scoped to the configured server origin, and expire after at most 30 days. Sign-out revokes the session and removes cached received files where possible.

For local iOS development, install Xcode, CocoaPods and an available simulator runtime, then run `npm run ios`. Android development needs the Android SDK and an emulator or device; run `npm run android`. Local native development defaults to `http://10.0.2.2:8000` on the Android emulator or `http://127.0.0.1:8000` on iOS. Web requests use the current page origin. Native release builds default to `https://fyde.mehmetuzgoren.workers.dev`; `EXPO_PUBLIC_API_URL` can select another HTTPS deployment. A physical phone needs an address it can reach.

`npm run bundle` compiles production iOS, Android and web JavaScript/Hermes bundles. `eas.json` includes simulator, internal-preview and production profiles. EAS, signing, store upload and paid cloud builds have not been activated. The `app.fyde.mobile` application identifiers are provisional and must be confirmed before distribution. `EXPO_PUBLIC_*` values are public build configuration; never put secrets in them.

Build locally with Xcode’s default simulator signing after native generation and CocoaPods installation:

```sh
npx expo prebuild --platform ios --no-install
COCOAPODS_DISABLE_STATS=1 pod install --project-directory=ios
xcodebuild -workspace ios/Fyde.xcworkspace -scheme Fyde \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build build
```

Keep simulator signing enabled. The unsigned package launched but SecureStore failed with “A required entitlement isn’t present.” Xcode’s simulator signing supplies the application identity used by Keychain; do not replace secure storage with plaintext to work around a packaging error. This Debug build needs the Expo Metro server for its JavaScript. The local build used Xcode 27, whose simulator interface is [Device Hub](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub). A simulator binary is not an installable signed iPhone release. Platform QA and distribution evidence are recorded separately in `product.md`.

## Connect a recipient's agent

The verified recipient opens **Agent connections** on the web or **Account** on mobile, selects a received case permission, and creates a scoped credential. The raw secret appears once. Store it in that agent's secret store. Only its hash is stored by Fyde. A credential expires in at most 30 days, never after the parent permission, and can be revoked independently.

The example is an actual HTTP requester, with no owner session or customer database access:

```sh
# FYDE_CASE_AGENT_TOKEN comes from the recipient agent's secret store.
python3 examples/request_case_documents.py \
  --server https://your-fyde-origin.example \
  --output ./received-case-files --types passport,visa
```

Omit `--types` to request all permitted types; add `--query` for a filename/title filter. Retain the printed `--operation-id` for retries. The client verifies every download against its immutable version's SHA-256 hash. Plain HTTP requires the explicit `--allow-http-local` flag and a recognized local fixture hostname.

The customer-agent protocol is:

| Endpoint | Capability |
| --- | --- |
| `GET /api/agents/v1/permissions/` | Inspect the one permission bound to this credential |
| `POST /api/agents/v1/requests/` | Request permitted types/query with a stable UUID `operation_id`; optional document-ID `after` cursor |
| `GET /api/agents/v1/requests/<id>/` | Inspect that credential's case request |
| `GET /api/agents/v1/received/<id>/download/` | Download one file released under the bound permission |

Agents send `Authorization: Bearer <scoped credential>`. Request bodies accept only `operation_id`, `types`, `query` and `after`. Each response contains per-file outcomes, available download cards and an optional next-page cursor. Pages contain at most ten candidate files; each nonempty page consumes one case request. Every released version/recipient consumes an ordinary send unit. Retries of the same operation reuse its result and do not consume another send. A new operation is a new intent, even for a previously sent file. Quota, channel, endpoint revision, case scope, sensitivity, pause, expiry and revocation are checked by trusted code. Ordinary transfer expiry is separate from the longer-lived case permission.

This protocol can be called by an external agent that implements it. A universal agent standard, arbitrary third-party agent connection and model-to-model negotiation are not claimed. Fyde's owner-side responder is deterministic. It creates an exact-version grant and uses the existing transfer controller for every permitted release.

## Customer and business boundaries

Device credentials authorize the signed-in customer's UI operations. Case-agent credentials authorize one received permission and cannot browse unrelated owned files, read chat, change account preferences or create permissions. Agent credentials cannot be exchanged for device credentials. Recipient-agent APIs require their scoped bearer credential. Native customer APIs use device bearer credentials; the hosted browser uses an HttpOnly session cookie with an exact-Origin mutation check. `CUSTOMER_API_ORIGINS` can add explicit browser origins. Legacy Django forms retain CSRF protection.

Case responders belong to the customer data plane. Development and marketing agents remain in the separate company plane, with sanitized feedback and synthetic fixtures. They receive no customer-agent credential, private conversation, customer storage mount, production database credential or authority to edit these controls.

## Verification evidence

`tests/test_chat_cases.py` contains ten integration journeys for the new disclosure and retry requirements. They exercise mobile setup, private multi-file uploads, case snapshots/future scope, sensitive exclusion, exact-byte downloads, owner-session-free recipient requests, cross-case and token denial, pagination, quota, chat ambiguity/context, CSRF and revocation. The existing delivery and company journeys remain in the required suite.

`artifacts/evidence/case-agent-workflow.json` records a separate Docker HTTP requester that downloaded and hash-verified two synthetic case documents. The container had one case credential, the requester script and an output directory. It had no owner credential, customer database or private-storage mount. No real legal or identity documents were used.

`artifacts/evidence/native-ios-workflow.json` records actual iPhone 17 Pro / iOS 26.0 simulator acceptance: secure sign-in/restoration, fresh onboarding, native multi-file import, contact and permission review, chat classification/find/send, owner-signed-out automatic request, Received download and Save to Files. The passport’s source, stored version, native cache and exported copy have the same SHA-256 hash. `ios-chat-home.png` and `ios-search-page.png` show the separate icon destinations. Fixtures are synthetic; native acceptance does not establish physical-device, Android-package, store or live-provider verification.
