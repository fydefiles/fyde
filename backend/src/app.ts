import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import type { Config } from "./config.js";
import { Database, type Row } from "./db.js";
import { ManagedAuth, profile } from "./auth.js";
import {
  PolicyError,
  audit,
  hash,
  later,
  random,
  rateLimit,
  requireValue,
  same,
  uuid,
} from "./core.js";
import {
  canDownload,
  checkPolicy,
  currentPeriod,
  entitlement,
  fileCard,
  loadPolicy,
  loadTransfer,
  loadVersion,
  policyCard,
} from "./policy.js";
import { Files, NeonObjects, type ObjectStore } from "./storage.js";
import { Sharing } from "./sharing.js";
import { Chat } from "./chat.js";
import { search } from "./search.js";

type Variables = { owner: Row; token: Row };
type AppContext = Context<{ Variables: Variables }>;
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const password = z.string().min(10).max(200);
const COOKIE = "fyde_session";
export function createApp(
  cfg: Config,
  dependencies: {
    db?: Database;
    auth?: ManagedAuth;
    objects?: ObjectStore;
  } = {},
) {
  const db = dependencies.db || new Database(cfg.databaseUrl),
    auth = dependencies.auth || new ManagedAuth(db, cfg);
  const files = new Files(
      db,
      dependencies.objects || new NeonObjects(cfg),
      cfg,
    ),
    sharing = new Sharing(db),
    chat = new Chat(db, sharing);
  const app = new Hono<{ Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    const origin = c.req.header("Origin");
    if (origin && !cfg.origins.includes(origin))
      return c.json(
        {
          error: "origin_denied",
          message: "This web origin is not authorized.",
        },
        403,
      );
    if (!same(c.req.header("X-Fyde-Edge-Key") || "", cfg.edgeKey))
      return c.json(
        { error: "unavailable", message: "Use the Fyde application URL." },
        403,
      );
    if (origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 30 * 1024 * 1024,
      onError: (c) =>
        c.json(
          {
            error: "file_size_limit",
            message: "This request exceeds the upload limit.",
          },
          413,
        ),
    }),
  );
  app.onError((error, c) => {
    if (error instanceof PolicyError)
      return c.json(
        { error: error.code, message: error.message },
        error.status as 400,
      );
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: "invalid_request",
          message: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(" "),
        },
        400,
      );
    if (
      error instanceof SyntaxError ||
      ["23505", "22P02", "23502", "23514", "23503"].includes(
        (error as Row).code,
      )
    )
      return c.json(
        {
          error: "invalid_request",
          message: "Check the supplied values and try again.",
        },
        400,
      );
    console.error("Fyde request failed.", {
      code:
        typeof (error as Row).code === "string"
          ? (error as Row).code
          : "unavailable",
    });
    return c.json(
      {
        error: "unavailable",
        message:
          "Fyde is temporarily unavailable. Please retry with the same operation.",
      },
      503,
    );
  });
  const publicPaths = new Set([
    "/api/v1/auth/config/",
    "/api/v1/login/",
    "/api/v1/signup/",
    "/api/v1/auth/verify/",
    "/api/v1/auth/send-code/",
    "/api/v1/auth/google/start/",
    "/api/v1/auth/google/exchange/",
    "/api/v1/auth/reset-code/",
    "/api/v1/auth/reset-password/",
  ]);
  const authenticate: MiddlewareHandler<{ Variables: Variables }> = async (
    c,
    next,
  ) => {
    if (publicPaths.has(c.req.path)) {
      const limits: Record<string, [number, number]> = {
        "/api/v1/auth/config/": [180, 60],
        "/api/v1/signup/": [5, 3600],
        "/api/v1/auth/verify/": [10, 900],
        "/api/v1/auth/send-code/": [5, 900],
        "/api/v1/auth/google/exchange/": [30, 900],
        "/api/v1/auth/reset-code/": [5, 900],
        "/api/v1/auth/reset-password/": [10, 900],
      };
      const [maximum, seconds] = limits[c.req.path] || [15, 900];
      await rateLimit(
        db,
        "public:" +
          (c.req.header("X-Fyde-Client-IP") || "unknown") +
          ":" +
          c.req.path,
        maximum,
        seconds,
      );
      return next();
    }
    const header = c.req.header("Authorization"),
      raw = header?.startsWith("Bearer ")
        ? header.slice(7)
        : getCookie(c, COOKIE) || "";
    if (!header && c.req.method !== "GET" && !c.req.header("Origin"))
      throw new PolicyError(
        "origin_denied",
        "Use the Fyde app to change your account.",
      );
    const agent = c.req.path.startsWith("/api/agents/");
    const identity = await auth.authenticate(
      raw,
      agent ? ["agent"] : ["device"],
      c.req.path !== "/api/v1/logout/",
    );
    if (agent) {
      const p = await loadPolicy(db, identity.token.policy_id);
      if (identity.token.policy_revision !== p.revision)
        throw new PolicyError(
          "scope_denied",
          "The case permission changed. Obtain a new scoped credential.",
        );
      await checkPolicy(db, p, identity.owner);
    }
    c.set("owner", identity.owner);
    c.set("token", identity.token);
    await rateLimit(db, "api:" + identity.token.id, 180, 60);
    await next();
  };
  app.use("/api/*", authenticate);
  const json = async (c: AppContext) =>
    z.record(z.string(), z.unknown()).parse(await c.req.json()) as Row;
  function loginResult(c: AppContext, result: Row) {
    setCookie(c, COOKIE, result.token, {
      httpOnly: true,
      secure: cfg.siteUrl.startsWith("https:"),
      sameSite: "Lax",
      path: "/",
      maxAge: Math.max(
        0,
        Math.floor((+new Date(result.expires_at) - Date.now()) / 1000),
      ),
    });
    return c.json(result);
  }
  app.get("/health/", (c) =>
    c.json({
      status: "ok",
      service: "fyde",
      runtime: "neon-functions",
      revision: cfg.revision,
    }),
  );
  app.get("/api/v1/auth/config/", (c) =>
    c.json({
      provider: "neon",
      google: cfg.googleEnabled !== false,
      email_verification: true,
      runtime: "typescript",
    }),
  );
  app.post("/api/v1/login/", async (c) => {
    const data = z
      .object({
        email,
        password: z.string().min(1).max(200),
        device_name: z.string().max(80).optional(),
      })
      .parse(await json(c));
    const { response } = await auth.call("sign-in/email", {
      email: data.email,
      password: data.password,
    });
    return loginResult(
      c,
      await auth.issue(await auth.fromResponse(response), data.device_name),
    );
  });
  app.post("/api/v1/signup/", async (c) => {
    const data = z
      .object({ email, password, name: z.string().trim().min(1).max(80) })
      .parse(await json(c));
    const { response } = await auth.call("sign-up/email", data);
    if (auth.cookies(response))
      try {
        return loginResult(
          c,
          await auth.issue(await auth.fromResponse(response)),
        );
      } catch (e) {
        if (
          !(e instanceof PolicyError) ||
          e.code !== "email_verification_required"
        )
          throw e;
      }
    return c.json({ verification_required: true, email: data.email });
  });
  app.post("/api/v1/auth/verify/", async (c) => {
    const data = z
      .object({ email, code: z.string().min(4).max(12) })
      .parse(await json(c));
    const { response } = await auth.call("email-otp/verify-email", {
      email: data.email,
      otp: data.code,
    });
    return auth.cookies(response)
      ? loginResult(c, await auth.issue(await auth.fromResponse(response)))
      : c.json({ verified: true, sign_in_required: true });
  });
  app.post("/api/v1/auth/send-code/", async (c) => {
    const data = z.object({ email }).parse(await json(c));
    await auth.call("email-otp/send-verification-otp", {
      email: data.email,
      type: "email-verification",
    });
    return c.json({
      message:
        "If verification is available for this email, a code is on its way.",
    });
  });
  app.post("/api/v1/auth/reset-code/", async (c) => {
    const data = z.object({ email }).parse(await json(c));
    await auth.call("email-otp/send-verification-otp", {
      email: data.email,
      type: "forget-password",
    });
    return c.json({
      message: "If this account can reset its password, a code is on its way.",
    });
  });
  app.post("/api/v1/auth/reset-password/", async (c) => {
    const data = z
      .object({ email, code: z.string().min(4).max(12), password })
      .parse(await json(c));
    await auth.call("email-otp/reset-password", {
      email: data.email,
      otp: data.code,
      password: data.password,
    });
    return c.json({ reset: true, message: "Password updated. Sign in again." });
  });
  app.post("/api/v1/auth/google/start/", async (c) => {
    if (cfg.googleEnabled === false)
      throw new PolicyError(
        "provider_unavailable",
        "Google sign-in is not configured. Use email and password.",
        503,
      );
    const data = z
      .object({
        code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        redirect_uri: z.string().max(500),
      })
      .parse(await json(c));
    const allowed = [
      "fyde://auth/callback",
      ...cfg.origins.map((o) => o + "/auth/callback"),
    ];
    if (!allowed.includes(data.redirect_uri))
      throw new PolicyError(
        "invalid_request",
        "Use the configured Fyde callback and an S256 challenge.",
        400,
      );
    const attempt = await db.insert("NeonOAuthAttempt", {
      code_challenge: data.code_challenge,
      redirect_uri: data.redirect_uri,
      expires_at: later(300),
    });
    return c.json({
      attempt: attempt.id,
      url: `${cfg.siteUrl}/auth/google/start/?ticket=${encodeURIComponent(auth.ticket(attempt.id))}`,
    });
  });
  app.get("/auth/google/start/", async (c) => {
    const result = await auth.googleStart(c.req.query("ticket") || "");
    setCookie(c, "fyde_oauth", result.pending, {
      httpOnly: true,
      secure: cfg.siteUrl.startsWith("https:"),
      sameSite: "Lax",
      path: "/auth/google/",
      maxAge: 300,
    });
    return c.redirect(result.url);
  });
  app.get("/auth/google/callback/", async (c) => {
    const target = await auth.googleFinish(
      getCookie(c, "fyde_oauth") || "",
      c.req.query("state") || "",
      c.req.query("neon_auth_session_verifier") || "",
    );
    deleteCookie(c, "fyde_oauth", { path: "/auth/google/" });
    return c.redirect(target);
  });
  app.post("/api/v1/auth/google/exchange/", async (c) =>
    loginResult(c, await auth.exchange(await json(c))),
  );
  app.get("/api/v1/session/", (c) => c.json({ user: profile(c.get("owner")) }));
  app.post("/api/v1/logout/", async (c) => {
    const result = await auth.signOut(c.get("token"));
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json(result);
  });
  app.get("/api/v1/state/", async (c) =>
    c.json(await sharing.workspace(c.get("owner"))),
  );
  app.post("/api/v1/verify-email/", (c) =>
    c.json({ message: "Your email is verified through Neon." }),
  );
  app.post("/api/v1/files/search/", async (c) => {
    const { query } = z
      .object({ query: z.string().max(180) })
      .parse(await json(c));
    return c.json(await search(db, c.get("owner"), query));
  });
  app.get("/api/v1/chat/", async (c) =>
    c.json({ turns: await chat.history(c.get("owner")) }),
  );
  app.post("/api/v1/chat/", async (c) => {
    await rateLimit(db, "customer-chat:" + c.get("owner").id, 60, 60);
    const data = await json(c);
    return c.json(
      await chat.converse(
        c.get("owner"),
        data.message,
        uuid(data.operation_id),
        data.channel,
        data.choice,
      ),
    );
  });
  app.post("/api/v1/chat/clear/", async (c) => {
    await db.query("DELETE FROM exchange_chatexchange WHERE owner_id=$1", [
      c.get("owner").id,
    ]);
    return c.json({ cleared: true });
  });
  app.post("/api/v1/preferences/", async (c) => {
    const data = z
      .object({
        default_channel: z.enum(["in_app", "email", "phone"]).optional(),
        chat_context_enabled: z.boolean().optional(),
        sharing_paused: z.boolean().optional(),
      })
      .strict()
      .parse(await json(c));
    const fields: Row = { ...data };
    if (data.default_channel) {
      fields.default_delivery_channel = data.default_channel;
      delete fields.default_channel;
    }
    const user = Object.keys(fields).length
      ? (await db.update("User", fields, "id=$1", [c.get("owner").id]))[0]
      : c.get("owner");
    await audit(db, user, "customer.preferences_changed", "", "owner_updated", {
      fields: Object.keys(fields),
    });
    return c.json({ user: profile(user) });
  });
  app.post("/api/v1/matters/", async (c) => {
    const data = await json(c);
    const item = await sharing.matter(c.get("owner"), data.name);
    return c.json({ id: item.id, name: item.name });
  });
  app.post("/api/v1/matters/:id/rename/", async (c) => {
    const data = z
      .object({ name: z.string() })
      .strict()
      .parse(await json(c));
    const item = await sharing.matter(
      c.get("owner"),
      data.name,
      uuid(c.req.param("id")),
    );
    return c.json({ id: item.id, name: item.name });
  });
  app.post("/api/v1/contacts/", async (c) =>
    c.json(await sharing.contact(c.get("owner"), await json(c))),
  );
  app.post("/api/v1/contacts/:id/update/", async (c) =>
    c.json(
      await sharing.contact(
        c.get("owner"),
        await json(c),
        uuid(c.req.param("id")),
      ),
    ),
  );
  app.post("/api/v1/upload/", async (c) => {
    const form = await c.req.formData(),
      file = form.get("file");
    if (!(file instanceof File))
      throw new PolicyError("file_required", "Choose a file.", 400);
    const data = Object.fromEntries(
      [...form.entries()].filter(([k]) => k !== "file"),
    );
    const v = await files.upload(c.get("owner"), file, data);
    return c.json({
      file: fileCard(v),
      message: "Uploaded privately. Safety checks are queued.",
    });
  });
  app.post("/api/v1/documents/:id/classify/", async (c) => {
    await files.classify(
      c.get("owner"),
      uuid(c.req.param("id")),
      await json(c),
    );
    return c.json({ updated: true });
  });
  app.get("/api/v1/documents/:id/", async (c) => {
    const id = uuid(c.req.param("id")),
      doc = requireValue(
        await db.one(
          "Document",
          "id=$1 AND owner_id=$2 AND deleted_at IS NULL",
          [id, c.get("owner").id],
        ),
      );
    const versions = [];
    for (const row of await db.rows(
      "FileVersion",
      "document_id=$1",
      [id],
      "ORDER BY number DESC",
    )) {
      const v = await loadVersion(db, row.id);
      versions.push({
        ...fileCard(v),
        sha256: v.sha256,
        check_detail: v.check_detail,
        extraction_state: v.extraction_state,
        preferred: doc.current_version_id === v.id,
      });
    }
    return c.json({ id: doc.id, title: doc.title, versions });
  });
  app.post("/api/v1/documents/:id/prefer/", async (c) => {
    const data = await json(c),
      owner = c.get("owner"),
      id = uuid(c.req.param("id"));
    const v = await loadVersion(db, uuid(data.version_id));
    if (
      v.document_id !== id ||
      v.document.owner_id !== owner.id ||
      v.document.deleted_at
    )
      throw new PolicyError("unavailable", "This version is unavailable.", 404);
    await db.update("Document", { current_version_id: v.id }, "id=$1", [id]);
    await audit(db, owner, "version.preferred", v.id, "owner_selected");
    return c.json({ updated: true });
  });
  app.post("/api/v1/documents/:id/delete/", async (c) => {
    const owner = c.get("owner"),
      data = await json(c),
      session = await db.one("NeonSession", "id=$1", [
        c.get("token").neon_session_id,
      ]);
    if (
      !session ||
      session.created_at < later(-300) ||
      String(data.confirm_email || "").toLowerCase() !==
        owner.email.toLowerCase()
    )
      throw new PolicyError(
        "recent_sign_in_required",
        "Sign in again and confirm your email before deleting originals.",
      );
    return c.json(await files.remove(owner, uuid(c.req.param("id"))));
  });
  app.post("/api/v1/policies/", async (c) => {
    const data = await json(c);
    return c.json({
      policy: policyCard(
        await sharing.createPolicy(
          c.get("owner"),
          data,
          uuid(data.operation_id),
        ),
      ),
    });
  });
  app.post("/api/v1/policies/:id/revoke/", async (c) =>
    c.json(await sharing.revokePolicy(c.get("owner"), uuid(c.req.param("id")))),
  );
  app.post("/api/v1/setup/complete/", async (c) => {
    const [user] = await db.update(
      "User",
      { onboarding_completed_at: new Date() },
      "id=$1",
      [c.get("owner").id],
    );
    return c.json({ user: profile(user) });
  });
  app.get("/api/v1/credentials/", async (c) =>
    c.json({
      tokens: (
        await db.rows(
          "CustomerToken",
          "owner_id=$1 AND revoked_at IS NULL AND expires_at>now()",
          [c.get("owner").id],
        )
      ).map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        expires_at: t.expires_at.toISOString(),
      })),
    }),
  );
  app.post("/api/v1/credentials/", async (c) =>
    c.json(await sharing.issueAgent(c.get("owner"), await json(c))),
  );
  app.post("/api/v1/credentials/:id/revoke/", async (c) => {
    requireValue(
      (
        await db.update(
          "CustomerToken",
          { revoked_at: new Date() },
          "id=$1 AND owner_id=$2",
          [uuid(c.req.param("id")), c.get("owner").id],
        )
      )[0],
    );
    return c.json({ revoked: true });
  });
  app.get("/api/v1/received/", async (c) =>
    c.json({ files: await sharing.received(c.get("owner")) }),
  );
  app.get("/api/v1/files/:id/download/", async (c) => {
    const v = await loadVersion(db, uuid(c.req.param("id")));
    if (v.document.owner_id !== c.get("owner").id || v.document.deleted_at)
      throw new PolicyError("unavailable", "This file is unavailable.", 404);
    return files.download(v);
  });
  const receivedDownload = async (c: AppContext) =>
    db.tx(async () => {
      const owner = c.get("owner"),
        token = c.get("token"),
        item = requireValue(
          await db.one("InboxItem", "id=$1 AND recipient_id=$2", [
            uuid(c.req.param("id")),
            owner.id,
          ]),
        );
      const t = await loadTransfer(db, item.transfer_id, true);
      if (
        token.kind === "agent" &&
        t.grant.standing_policy_id !== token.policy_id
      )
        throw new PolicyError("unavailable", "This item is unavailable.", 404);
      await canDownload(db, owner, t);
      if (
        ![
          "provider_accepted",
          "delivered",
          "accessed",
          "test_available",
          "available_in_app",
        ].includes(t.status)
      )
        throw new PolicyError(
          "not_sent",
          "The transfer is not available for download.",
        );
      const { plan } = await entitlement(db, t.owner),
        period = await currentPeriod(db, t.owner),
        changed = await db.query(
          "UPDATE exchange_usageperiod SET bandwidth_used=bandwidth_used+$2::bigint WHERE id=$1 AND bandwidth_used<=$3::bigint-$2::bigint RETURNING id",
          [period.id, Number(t.version.size), plan.bandwidth_mib * 1024 * 1024],
        );
      if (!changed.length)
        throw new PolicyError(
          "bandwidth_limit",
          "This account has reached its download bandwidth limit.",
        );
      const response = await files.download(t.version);
      await db.update(
        "Transfer",
        { accessed_at: new Date(), status: "accessed" },
        "id=$1",
        [t.id],
      );
      await audit(
        db,
        t.owner,
        "transfer.accessed",
        t.id,
        "verified_recipient_access",
      );
      return response;
    });
  app.get("/api/v1/received/:id/download/", receivedDownload);
  app.get("/api/agents/v1/received/:id/download/", receivedDownload);
  app.post("/api/v1/case-requests/", async (c) => {
    const data = await json(c);
    return c.json(
      await sharing.requestResult(
        await sharing.fulfill(
          c.get("owner"),
          uuid(data.policy_id),
          uuid(data.operation_id),
          data,
        ),
        c.get("owner"),
      ),
    );
  });
  app.get("/api/agents/v1/permissions/", async (c) =>
    c.json({
      protocol: "fyde-case-request/v1",
      permission: policyCard(await loadPolicy(db, c.get("token").policy_id)),
    }),
  );
  app.post("/api/agents/v1/requests/", async (c) => {
    const data = z
      .object({
        operation_id: z.string(),
        types: z.array(z.string()).optional(),
        query: z.string().max(180).optional(),
        after: z.string().max(36).optional(),
      })
      .strict()
      .parse(await json(c));
    return c.json(
      await sharing.requestResult(
        await sharing.fulfill(
          c.get("owner"),
          c.get("token").policy_id,
          uuid(data.operation_id),
          data,
        ),
        c.get("owner"),
        true,
      ),
    );
  });
  app.get("/api/agents/v1/requests/:id/", async (c) => {
    const record = requireValue(
      await db.one(
        "CaseRequest",
        "id=$1 AND requester_id=$2 AND policy_id=$3",
        [uuid(c.req.param("id")), c.get("owner").id, c.get("token").policy_id],
      ),
    );
    return c.json(await sharing.requestResult(record, c.get("owner"), true));
  });
  app.get("/api/v1/transfers/", async (c) =>
    c.json({
      transfers: await db.query(
        "SELECT t.id,t.status,t.channel,t.created_at,v.original_name AS title FROM exchange_transfer t JOIN exchange_fileversion v ON v.id=t.version_id WHERE t.owner_id=$1 ORDER BY t.created_at DESC LIMIT 100",
        [c.get("owner").id],
      ),
    }),
  );
  app.get("/api/v1/transfers/:id/", async (c) => {
    const t = await loadTransfer(db, uuid(c.req.param("id")));
    if (t.owner_id !== c.get("owner").id)
      throw new PolicyError("unavailable", "This receipt is unavailable.", 404);
    return c.json({
      id: t.id,
      title: t.version.document.title,
      name: t.version.original_name,
      number: t.version.number,
      recipient: t.contact.name,
      endpoint: t.channel === "phone" ? t.recipient_phone : t.recipient_email,
      status: t.status,
      sha256: t.version.sha256,
      channel: t.channel,
      created_at: t.created_at,
      expires_at: t.expires_at,
      accepted_at: t.accepted_at,
      accessed_at: t.accessed_at,
      revoked_at: t.revoked_at,
      quota_state: t.quota_state,
    });
  });
  app.post("/api/v1/transfers/:id/revoke/", async (c) =>
    c.json(await sharing.revoke(c.get("owner"), uuid(c.req.param("id")))),
  );
  app.get("/api/v1/export/", async (c) =>
    c.json({
      workspace: await sharing.workspace(c.get("owner")),
      received: await sharing.received(c.get("owner")),
      activity: await db.rows(
        "AuditEvent",
        "owner_id=$1",
        [c.get("owner").id],
        "ORDER BY created_at DESC LIMIT 1000",
      ),
    }),
  );
  app.get("/api/v1/feedback/", async (c) =>
    c.json({
      items: (
        await db.rows(
          "FeedbackBridge",
          "owner_id=$1",
          [c.get("owner").id],
          "ORDER BY created_at DESC LIMIT 100",
        )
      ).map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        visibility: item.visibility,
        created_at: item.created_at,
      })),
    }),
  );
  app.post("/api/v1/feedback/", async (c) => {
    await rateLimit(db, "feedback:" + c.get("owner").id, 5, 3600);
    const data = z
      .object({
        title: z.string().trim().min(1).max(140),
        body: z.string().trim().min(1).max(5000),
        visibility: z.enum(["private", "public"]),
        consent: z.boolean().optional(),
      })
      .parse(await json(c));
    if (data.visibility === "public" && data.consent !== true)
      throw new PolicyError(
        "consent_required",
        "Explicitly approve public feedback before submitting.",
      );
    const item = await db.insert("FeedbackBridge", {
      owner_id: c.get("owner").id,
      title: data.title,
      body: data.body,
      visibility: data.visibility,
    });
    return c.json({
      id: item.id,
      message:
        data.visibility === "public"
          ? "Saved for review before public use."
          : "Saved as a private support request.",
    });
  });
  app.post("/api/v1/feedback/:id/withdraw/", async (c) => {
    requireValue(
      (
        await db.update(
          "FeedbackBridge",
          { body: "", title: "Withdrawn feedback", visibility: "withdrawn" },
          "id=$1 AND owner_id=$2",
          [uuid(c.req.param("id")), c.get("owner").id],
        )
      )[0],
    );
    return c.json({ withdrawn: true });
  });
  app.notFound((c) =>
    c.json(
      { error: "unavailable", message: "This endpoint is unavailable." },
      404,
    ),
  );
  return { app, db, auth, files, sharing, chat };
}
