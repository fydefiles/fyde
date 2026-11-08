import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import type { Config } from "../src/config.js";
import { Database, type Row } from "../src/db.js";
import { ManagedAuth } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { PolicyError, hash } from "../src/core.js";
import type { ObjectStore } from "../src/storage.js";

const databaseUrl = process.env.FYDE_INTEGRATION_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "Set FYDE_INTEGRATION_DATABASE_URL to the disposable PostgreSQL database.",
  );
const target = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost", "postgres"].includes(target.hostname) ||
  !target.pathname.endsWith("_test")
)
  throw new Error(
    "Integration journeys require a dedicated local *_test database.",
  );
const db = new Database(databaseUrl);
const cfg: Config = {
  databaseUrl,
  siteUrl: "https://fyde.fixture.test",
  authUrl: "https://auth.fixture.test/auth",
  secret: "fixture-only-fyde-session-secret-for-integration-checks",
  edgeKey: "fixture-edge",
  jobKey: "fixture-job",
  origins: ["https://fyde.fixture.test"],
  revision: "fixture",
  bucket: "uploads",
  s3Endpoint: "https://storage.fixture.test",
  s3Key: "fixture",
  s3Secret: "fixture",
  region: "us-east-2",
  scannerHost: "",
  scannerPort: 3310,
};
const identities = new Map<string, Row>(),
  sessions = new Map<string, Row>();
let providerOffline = false;
const upstream: typeof fetch = async (input, init) => {
  if (providerOffline) throw new Error("Provider unavailable");
  const url = new URL(String(input)),
    body = init?.body ? JSON.parse(String(init.body)) : {};
  const headers = new Headers(init?.headers),
    path = url.pathname.split("/auth/")[1];
  if (path === "sign-in/email") {
    if (body.password !== "fixture-password")
      return Response.json(
        { code: "INVALID_EMAIL_OR_PASSWORD" },
        { status: 401 },
      );
    let identity = identities.get(body.email);
    if (!identity) {
      identity = {
        id: randomUUID(),
        email: body.email,
        emailVerified: true,
        name: body.email.split("@")[0],
      };
      identities.set(body.email, identity);
    }
    const raw = randomUUID(),
      session = {
        id: randomUUID(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
    sessions.set(raw, { session, user: identity });
    const response = Response.json({ session, user: identity });
    response.headers.append(
      "set-cookie",
      `__Secure-neon-auth.session_token=${raw}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`,
    );
    return response;
  }
  if (path === "get-session") {
    if (url.searchParams.has("neon_auth_session_verifier")) {
      const response = Response.json({});
      const raw = [...sessions.keys()].at(-1)!;
      response.headers.append(
        "set-cookie",
        `__Secure-neon-auth.session_token=${raw}; Path=/; Secure; HttpOnly`,
      );
      return response;
    }
    assert.equal(url.searchParams.get("disableCookieCache"), "true");
    const raw = headers.get("cookie")?.split("=")[1];
    return Response.json(raw ? sessions.get(raw) || null : null);
  }
  if (path === "sign-out") {
    sessions.delete(headers.get("cookie")?.split("=")[1] || "");
    return Response.json({ success: true });
  }
  if (path === "sign-in/social") {
    const response = Response.json({
      url: "https://accounts.google.com/fixture",
    });
    response.headers.append(
      "set-cookie",
      "__Secure-neon-auth.session_challenge=fixture-challenge; Path=/; Secure; HttpOnly",
    );
    return response;
  }
  return Response.json({ success: true });
};
class FixtureObjects implements ObjectStore {
  blobs = new Map<string, Uint8Array>();
  unavailable = false;
  async put(key: string, body: Uint8Array) {
    this.blobs.set(key, body.slice());
  }
  async get(v: Row) {
    if (this.unavailable)
      throw new PolicyError("storage_unavailable", "Storage unavailable.", 503);
    const b = this.blobs.get(v.blob_key);
    if (!b || b.length !== Number(v.size) || hash(b) !== v.sha256)
      throw new PolicyError(
        "hash_mismatch",
        "Stored content failed its integrity check.",
      );
    return b;
  }
  async delete(key: string) {
    if (this.unavailable)
      throw new PolicyError("storage_unavailable", "Storage unavailable.", 503);
    this.blobs.delete(key);
  }
}
const objects = new FixtureObjects(),
  auth = new ManagedAuth(db, cfg, upstream),
  backend = createApp(cfg, { db, auth, objects });
async function request(
  path: string,
  token?: string,
  body?: Row | FormData,
  method = body ? "POST" : "GET",
) {
  const headers: Record<string, string> = {
    "X-Fyde-Edge-Key": cfg.edgeKey,
    "X-Fyde-Client-IP": "fixture",
    Origin: cfg.siteUrl,
  };
  if (token) headers.Authorization = "Bearer " + token;
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  return backend.app.request(
    new Request(cfg.siteUrl + path, {
      method,
      headers,
      body: body
        ? body instanceof FormData
          ? body
          : JSON.stringify(body)
        : undefined,
    }),
  );
}
async function json(path: string, token?: string, body?: Row, expected = 200) {
  const response = await request(path, token, body),
    value = await response.json();
  assert.equal(response.status, expected, JSON.stringify(value));
  return value;
}
async function login(email: string) {
  return json("/api/v1/login/", undefined, {
    email,
    password: "fixture-password",
  });
}
async function upload(
  token: string,
  name: string,
  body: string,
  extra: Row = {},
) {
  const form = new FormData();
  form.append("file", new File([body], name, { type: "text/plain" }));
  for (const [key, value] of Object.entries(extra))
    form.append(key, String(value));
  const response = await request("/api/v1/upload/", token, form),
    value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  return value.file;
}
async function contact(token: string, email: string, name = "Recipient") {
  return json("/api/v1/contacts/", token, {
    name,
    email,
    relationship: "Lawyer",
  });
}
async function send(token: string, message: string, operation = randomUUID()) {
  return json("/api/v1/chat/", token, {
    message,
    operation_id: operation,
    channel: "in_app",
  });
}
before(async () => {
  await db.query("TRUNCATE exchange_user RESTART IDENTITY CASCADE");
  await db.query("TRUNCATE exchange_ratelimit");
});
after(async () => {
  await db.pool.end();
});

test("verified identity, provider revocation, cookies, and logout during an outage", async () => {
  const signed = await login("identity@fixture.test");
  assert.equal(signed.user.email_verified, true);
  const again = await login("identity@fixture.test");
  assert.equal(again.user.id, signed.user.id);
  const response = await request("/api/v1/login/", undefined, {
    email: "identity@fixture.test",
    password: "fixture-password",
  });
  assert.match(response.headers.get("set-cookie")!, /fyde_session=.*HttpOnly/);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const state = await backend.app.request(
    new Request(cfg.siteUrl + "/api/v1/state/", {
      headers: { "X-Fyde-Edge-Key": cfg.edgeKey, Cookie: cookie },
    }),
  );
  assert.equal(state.status, 200);
  const s = await db.one(
    "NeonSession",
    "owner_id=$1",
    [signed.user.id],
    "ORDER BY created_at",
  );
  const raw = auth.cipher.decrypt(s!.upstream_cookie).split("=")[1];
  sessions.delete(raw);
  await json("/api/v1/state/", signed.token, undefined, 401);
  providerOffline = true;
  const out = await json("/api/v1/logout/", again.token, {});
  assert.equal(out.signed_out, true);
  assert.equal(out.provider_signed_out, false);
  providerOffline = false;
  await json("/api/v1/state/", again.token, undefined, 401);
  identities.set("unverified@fixture.test", {
    id: randomUUID(),
    email: "unverified@fixture.test",
    emailVerified: false,
    name: "Unverified",
  });
  await json(
    "/api/v1/login/",
    undefined,
    { email: "unverified@fixture.test", password: "fixture-password" },
    403,
  );
  const forged = await backend.app.request(
    new Request(cfg.siteUrl + "/api/v1/state/", {
      headers: {
        Authorization: "Bearer " + signed.token,
        "X-Fyde-Edge-Key": "wrong",
      },
    }),
  );
  assert.equal(forged.status, 403);
});

test("private bytes, tenant isolation, exact-version sharing, idempotency and revocation", async () => {
  const a = await login("sender@fixture.test"),
    b = await login("recipient@fixture.test"),
    foreign = await login("foreign@fixture.test");
  const f = await upload(
    a.token,
    "Passport.txt",
    "Synthetic passport record only.",
  );
  assert.equal(f.state, "quarantined");
  assert.equal((await json("/api/v1/files/search/", a.token, { query: "passport" })).files.length, 0);
  await backend.files.process();
  const workspace = await json("/api/v1/state/", a.token);
  assert.equal(workspace.files[0].state, "ready");
  const found = await json("/api/v1/files/search/", a.token, { query: "synthetic record" });
  assert.equal(found.semantic_status, "disabled");
  assert.equal(found.files[0].id, f.id);
  assert.match(found.files[0].match.excerpt, /Synthetic passport record/);
  assert.deepEqual((await json("/api/v1/files/search/", foreign.token, { query: "synthetic record" })).files, []);
  await json(`/api/v1/files/${f.id}/download/`, foreign.token, undefined, 404);
  const ownerDownload = await request(
    `/api/v1/files/${f.id}/download/`,
    a.token,
  );
  assert.equal(await ownerDownload.text(), "Synthetic passport record only.");
  await contact(a.token, "recipient@fixture.test");
  const operation = randomUUID(),
    first = await send(a.token, "Send Passport to Recipient", operation),
    again = await send(a.token, "Send Passport to Recipient", operation);
  assert.deepEqual(first, again);
  assert.equal(first.result.transfers[0].state, "available_in_app");
  await json(
    "/api/v1/chat/",
    a.token,
    { message: "Find Passport", operation_id: operation },
    409,
  );
  const inbox = await json("/api/v1/received/", b.token);
  assert.equal(inbox.files.length, 1);
  const item = inbox.files[0],
    download = await request(item.api_download_url, b.token);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "Synthetic passport record only.");
  const version = (await db.one("FileVersion", "id=$1", [f.id]))!;
  objects.blobs.set(
    version.blob_key,
    new TextEncoder().encode("Corrupted provider bytes"),
  );
  await json(item.api_download_url, b.token, undefined, 403);
  objects.blobs.set(
    version.blob_key,
    new TextEncoder().encode("Synthetic passport record only."),
  );
  await json("/api/v1/preferences/", a.token, { sharing_paused: true });
  await json(item.api_download_url, b.token, undefined, 403);
  await json("/api/v1/preferences/", a.token, { sharing_paused: false });
  const t = first.result.transfers[0];
  await json(`/api/v1/transfers/${t.id}/revoke/`, a.token, {});
  await json(item.api_download_url, b.token, undefined, 403);
  assert.equal(
    (await json("/api/v1/received/", b.token)).files[0].available,
    false,
  );
  const period = await db.one("UsagePeriod", "owner_id=$1", [a.user.id]);
  assert.equal(period!.consumed, 1);
  assert.equal(period!.reserved, 0);
  assert.equal(
    (await json("/api/v1/files/search/", foreign.token, { query: "passport" }))
      .files.length,
    0,
  );
});

test("case snapshots, recipient-agent scope, endpoint changes and permission revocation", async () => {
  const a = await login("caseowner@fixture.test"),
    b = await login("casepeer@fixture.test");
  const c = await contact(a.token, "casepeer@fixture.test", "Case peer"),
    m = await json("/api/v1/matters/", a.token, { name: "Immigration case" });
  const f = await upload(
    a.token,
    "Case passport.txt",
    "Synthetic case document.",
    { matter_id: m.id, document_type: "passport" },
  );
  await backend.files.process();
  const policy = (
    await json("/api/v1/policies/", a.token, {
      contact_id: c.id,
      matter_id: m.id,
      operation_id: randomUUID(),
      confirm: true,
      types: ["passport"],
      future_files: false,
      future_versions: false,
      sensitive: false,
    })
  ).policy;
  const credential = await json("/api/v1/credentials/", b.token, {
    policy_id: policy.id,
    name: "Case agent",
  });
  await json("/api/v1/state/", credential.token, undefined, 403);
  await json(
    "/api/v1/preferences/",
    credential.token,
    { sharing_paused: true },
    403,
  );
  const op = randomUUID(),
    result = await json("/api/agents/v1/requests/", credential.token, {
      operation_id: op,
    });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].id, f.id);
  assert.deepEqual(
    await json("/api/agents/v1/requests/", credential.token, {
      operation_id: op,
    }),
    result,
  );
  await json(
    "/api/agents/v1/requests/",
    credential.token,
    { operation_id: op, query: "different" },
    409,
  );
  const next = await upload(
    a.token,
    "Case passport v2.txt",
    "New synthetic version.",
    { document_id: f.document_id, matter_id: m.id, document_type: "passport" },
  );
  await backend.files.process();
  await json(`/api/v1/documents/${f.document_id}/prefer/`, a.token, {
    version_id: next.id,
  });
  const future = await upload(
    a.token,
    "Future passport.txt",
    "Future synthetic file.",
    { matter_id: m.id, document_type: "passport" },
  );
  await backend.files.process();
  const snapshot = await json("/api/agents/v1/requests/", credential.token, {
    operation_id: randomUUID(),
  });
  assert.deepEqual(
    snapshot.files.map((v: Row) => v.id),
    [f.id],
  );
  assert.ok(snapshot.files.every((v: Row) => v.id !== future.id));
  await json(`/api/v1/contacts/${c.id}/update/`, a.token, {
    email: "sender@fixture.test",
  });
  await json(
    "/api/agents/v1/requests/",
    credential.token,
    { operation_id: randomUUID() },
    403,
  );
  const another = await contact(
    a.token,
    "casepeer@fixture.test",
    "Current peer",
  );
  const p2 = (
    await json("/api/v1/policies/", a.token, {
      contact_id: another.id,
      matter_id: m.id,
      operation_id: randomUUID(),
      confirm: true,
      types: ["*"],
      future_files: true,
      future_versions: true,
    })
  ).policy;
  const key2 = await json("/api/v1/credentials/", b.token, {
    policy_id: p2.id,
  });
  await json(`/api/v1/policies/${p2.id}/revoke/`, a.token, {});
  await json("/api/agents/v1/permissions/", key2.token, undefined, 403);
});

test("concurrent sends cannot consume the final quota unit twice", async () => {
  const a = await login("quotaowner@fixture.test");
  await login("quotapeer@fixture.test");
  await contact(a.token, "quotapeer@fixture.test", "Quota peer");
  await upload(a.token, "Quota.txt", "Synthetic concurrency record.");
  await backend.files.process();
  await json("/api/v1/state/", a.token);
  await db.query(
    "UPDATE exchange_usageperiod SET consumed=9 WHERE owner_id=$1",
    [a.user.id],
  );
  const results = await Promise.all([
    send(a.token, "Send Quota to Quota peer"),
    send(a.token, "Send Quota to Quota peer"),
  ]);
  const outcomes = results.flatMap((v) => v.result.transfers);
  assert.equal(
    outcomes.filter((v) => v.state === "available_in_app").length,
    1,
  );
  assert.equal(outcomes.filter((v) => v.state === "quota_exceeded").length, 1);
  const p = await db.one("UsagePeriod", "owner_id=$1", [a.user.id]);
  assert.equal(p!.consumed, 10);
  assert.equal(p!.reserved, 0);
});

test("deletion revokes access immediately, retains failed removal for retry, and does not resurrect scan results", async () => {
  const a = await login("deleteowner@fixture.test"),
    b = await login("deletepeer@fixture.test");
  await contact(a.token, "deletepeer@fixture.test");
  const f = await upload(
    a.token,
    "Disposable.txt",
    "Disposable synthetic deletion record.",
  );
  await backend.files.process();
  await send(a.token, "Send Disposable to Recipient");
  const inbox = (await json("/api/v1/received/", b.token)).files;
  objects.unavailable = true;
  await json(`/api/v1/documents/${f.document_id}/delete/`, a.token, {
    confirm_email: a.user.email,
  });
  await json(inbox[0].api_download_url, b.token, undefined, 403);
  assert.equal((await json("/api/v1/state/", a.token)).files.length, 0);
  await backend.files.process();
  assert.equal(
    (await db.one("FileVersion", "id=$1", [f.id]))!.blob_deleted_at,
    null,
  );
  objects.unavailable = false;
  await backend.files.process();
  const deleted = (await db.one("FileVersion", "id=$1", [f.id]))!;
  assert.ok(deleted.blob_deleted_at);
  assert.equal(deleted.extracted_text, "");
  assert.equal(deleted.state, "deleted");
  const blocked = await upload(a.token, "Unsafe.txt", "Bad\0text");
  await backend.files.process();
  assert.equal(
    (await db.one("FileVersion", "id=$1", [blocked.id]))!.state,
    "quarantined",
  );
});

test("Google challenge state, S256 exchange and single-use redemption", async () => {
  const a = await login("googlepeer@fixture.test");
  const verifier = "a".repeat(64),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const attempt = await json("/api/v1/auth/google/start/", undefined, {
    code_challenge: challenge,
    redirect_uri: cfg.siteUrl + "/auth/callback",
  });
  const ticket = new URL(attempt.url).searchParams.get("ticket")!,
    started = await auth.googleStart(ticket);
  const pending = JSON.parse(auth.cipher.decrypt(started.pending));
  await assert.rejects(
    () => auth.googleFinish(started.pending, "wrong", "fixture"),
    PolicyError,
  );
  const target = await auth.googleFinish(
      started.pending,
      pending.state,
      "fixture",
    ),
    code = new URL(target).searchParams.get("code");
  const exchanged = await json("/api/v1/auth/google/exchange/", undefined, {
    attempt: attempt.attempt,
    code,
    code_verifier: verifier,
  });
  assert.equal(exchanged.user.id, a.user.id);
  await json(
    "/api/v1/auth/google/exchange/",
    undefined,
    { attempt: attempt.attempt, code, code_verifier: verifier },
    401,
  );
});
