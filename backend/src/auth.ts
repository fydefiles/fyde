import { createHash, createHmac } from "node:crypto";
import type { Config } from "./config.js";
import type { Database, Row } from "./db.js";
import {
  PolicyError,
  SessionCipher,
  audit,
  hash,
  later,
  random,
  requireValue,
  same,
} from "./core.js";

const SESSION = "__Secure-neon-auth.session_token";
const CHALLENGES = [
  "__Secure-neon-auth.session_challenge",
  "__Secure-neon-auth.session_challange",
];
export class ManagedAuth {
  readonly cipher: SessionCipher;
  constructor(
    readonly db: Database,
    readonly config: Config,
    readonly upstream: typeof fetch = fetch,
  ) {
    this.cipher = new SessionCipher(config.secret);
  }
  async call(
    path: string,
    data?: Row,
    cookie = "",
    params: Record<string, string> = {},
  ) {
    let response: Response;
    try {
      response = await this.upstream(
        `${this.config.authUrl}/${path}?${new URLSearchParams(params)}`,
        {
          method: data ? "POST" : "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
          headers: {
            Origin: this.config.siteUrl,
            Cookie: cookie,
            "x-neon-auth-middleware": "true",
            ...(data ? { "Content-Type": "application/json" } : {}),
          },
          body: data ? JSON.stringify(data) : undefined,
        },
      );
    } catch {
      throw new PolicyError(
        "auth_unavailable",
        "Sign-in is temporarily unavailable. Please retry.",
        503,
      );
    }
    if (response.status >= 500)
      throw new PolicyError(
        "auth_unavailable",
        "Sign-in is temporarily unavailable. Please retry.",
        503,
      );
    if (response.status === 429)
      throw new PolicyError(
        "rate_limited",
        "Too many sign-in attempts. Try again shortly.",
        429,
      );
    const payload: Row | null = await response.json().catch(() => {
      throw new PolicyError(
        "auth_unavailable",
        "Sign-in returned an unreadable response. Please retry.",
        503,
      );
    });
    if (!response.ok) {
      if (
        ["EMAIL_NOT_VERIFIED", "EMAIL_VERIFICATION_REQUIRED"].includes(
          payload?.code,
        )
      )
        throw new PolicyError(
          "email_verification_required",
          "Enter the verification code sent to your email.",
        );
      if (
        [
          "INVALID_CALLBACKURL",
          "INVALID_ORIGIN",
          "INVALID_REDIRECT_URL",
        ].includes(payload?.code)
      )
        throw new PolicyError(
          "auth_unavailable",
          "Sign-in is temporarily unavailable. Please retry.",
          503,
        );
      throw new PolicyError(
        "authentication_required",
        "Check your sign-in details or verification code.",
        401,
      );
    }
    return { response, payload };
  }
  cookies(response: Response, names = [SESSION]) {
    return response.headers
      .getSetCookie()
      .map((header) => header.split(";", 1)[0])
      .filter((pair) => {
        const index = pair.indexOf("=");
        return (
          index > 0 &&
          names.includes(pair.slice(0, index)) &&
          pair.slice(index + 1)
        );
      })
      .join("; ");
  }
  async map(identity: Row) {
    const subject = String(identity.id || ""),
      email = String(identity.email || "")
        .trim()
        .toLowerCase();
    if (
      !subject ||
      subject.length > 128 ||
      !email ||
      email.length > 254 ||
      identity.emailVerified !== true ||
      identity.banned
    )
      throw new PolicyError(
        "email_verification_required",
        "Verify your email before signing in to Fyde.",
      );
    return this.db.tx(async () => {
      // Serializing the verified identity avoids duplicate account linking across concurrent callbacks.
      await this.db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [email],
      );
      let user = await this.db.one(
        "User",
        "neon_subject=$1",
        [subject],
        "FOR UPDATE",
      );
      if (user) {
        if (
          !user.is_active ||
          user.email.toLowerCase() !== email ||
          user.data_mode !== "live"
        )
          throw new PolicyError(
            "authentication_required",
            "This identity needs account support before signing in.",
            401,
          );
        if (!user.email_verified)
          [user] = await this.db.update(
            "User",
            { email_verified: true },
            "id=$1",
            [user.id],
          );
        return user;
      }
      user = await this.db.one(
        "User",
        "lower(email)=$1",
        [email],
        "FOR UPDATE",
      );
      if (
        user &&
        (user.neon_subject ||
          !user.email_verified ||
          user.data_mode !== "live" ||
          !user.is_active)
      )
        throw new PolicyError(
          "account_link_required",
          "This email already belongs to an account that needs verified linking.",
        );
      const values = {
        neon_subject: subject,
        email_verified: true,
        first_name: String(identity.name || user?.first_name || "").slice(
          0,
          80,
        ),
        password: "!" + random(),
      };
      if (user)
        [user] = await this.db.update("User", values, "id=$1", [user.id]);
      else
        user = await this.db.insert("User", {
          ...values,
          email,
          username: random().slice(0, 32),
          data_mode: "live",
          is_active: true,
        });
      await audit(
        this.db,
        user,
        "identity.neon_linked",
        "",
        "verified_email_and_subject",
      );
      return user;
    });
  }
  async fromResponse(response: Response): Promise<Row> {
    const cookie = this.cookies(response);
    if (!cookie)
      throw new PolicyError(
        "authentication_required",
        "Sign in again after verifying your email.",
        401,
      );
    const { payload } = await this.call("get-session", undefined, cookie, {
      disableCookieCache: "true",
    });
    if (!payload?.user || !payload.session)
      throw new PolicyError(
        "authentication_required",
        "The sign-in session is unavailable.",
        401,
      );
    const owner = await this.map(payload.user),
      expiry = new Date(payload.session.expiresAt);
    if (!Number.isFinite(+expiry) || expiry <= new Date())
      throw new PolicyError(
        "authentication_required",
        "The sign-in session expired.",
        401,
      );
    return this.db.insert("NeonSession", {
      owner_id: owner.id,
      upstream_cookie: this.cipher.encrypt(cookie),
      upstream_id: String(payload.session.id),
      expires_at: expiry,
    });
  }
  async validate(session: Row, user: Row) {
    if (
      session.revoked_at ||
      session.expires_at <= new Date() ||
      !user.is_active ||
      user.data_mode !== "live"
    )
      throw new PolicyError(
        "authentication_required",
        "This sign-in session expired or was revoked.",
        401,
      );
    const { payload } = await this.call(
      "get-session",
      undefined,
      this.cipher.decrypt(session.upstream_cookie),
      { disableCookieCache: "true" },
    );
    if (
      !payload?.session ||
      !payload.user ||
      payload.session.id !== session.upstream_id ||
      payload.user.id !== user.neon_subject ||
      payload.user.emailVerified !== true ||
      payload.user.banned ||
      String(payload.user.email).toLowerCase() !== user.email.toLowerCase() ||
      new Date(payload.session.expiresAt) <= new Date()
    ) {
      await this.db.update("NeonSession", { revoked_at: new Date() }, "id=$1", [
        session.id,
      ]);
      throw new PolicyError(
        "authentication_required",
        "This sign-in session expired or was revoked.",
        401,
      );
    }
  }
  async issue(session: Row, name = "Fyde device") {
    const owner = requireValue(
      await this.db.one("User", "id=$1", [session.owner_id]),
    );
    const raw = "fyde_device_" + random();
    const token = await this.db.insert("CustomerToken", {
      owner_id: owner.id,
      neon_session_id: session.id,
      kind: "device",
      name: name.slice(0, 80),
      token_hash: hash(raw),
      data_mode: owner.data_mode,
      expires_at: new Date(Math.min(+later(30 * 86400), +session.expires_at)),
    });
    await audit(
      this.db,
      owner,
      "customer_credential.issued",
      token.id,
      "device",
    );
    return {
      token: raw,
      expires_at: token.expires_at.toISOString(),
      user: profile(owner),
    };
  }
  async authenticate(raw: string, kinds = ["device"], validateProvider = true) {
    if (!raw || raw.length > 250)
      throw new PolicyError(
        "authentication_required",
        "Sign in again to continue.",
        401,
      );
    const token = await this.db.one(
      "CustomerToken",
      "token_hash=$1 AND revoked_at IS NULL AND expires_at>now()",
      [hash(raw)],
    );
    const owner =
      token && (await this.db.one("User", "id=$1", [token.owner_id]));
    if (
      !token ||
      !owner ||
      !owner.is_active ||
      token.data_mode !== owner.data_mode
    )
      throw new PolicyError(
        "authentication_required",
        "This credential expired or was revoked.",
        401,
      );
    if (!kinds.includes(token.kind))
      throw new PolicyError(
        "scope_denied",
        "This credential cannot access that customer operation.",
      );
    if (token.kind === "device" && validateProvider) {
      const session =
        token.neon_session_id &&
        (await this.db.one("NeonSession", "id=$1 AND owner_id=$2", [
          token.neon_session_id,
          owner.id,
        ]));
      if (!session)
        throw new PolicyError(
          "authentication_required",
          "Sign in again with your Neon account.",
          401,
        );
      await this.validate(session, owner);
    }
    return { token, owner };
  }
  async signOut(token: Row) {
    // Local cancellation must survive an upstream outage.
    await this.db.update("CustomerToken", { revoked_at: new Date() }, "id=$1", [
      token.id,
    ]);
    let provider = false;
    if (token.neon_session_id) {
      const session = await this.db.one(
        "NeonSession",
        "id=$1 AND owner_id=$2",
        [token.neon_session_id, token.owner_id],
      );
      if (session) {
        await this.db.update(
          "NeonSession",
          { revoked_at: new Date() },
          "id=$1",
          [session.id],
        );
        try {
          await this.call(
            "sign-out",
            {},
            this.cipher.decrypt(session.upstream_cookie),
          );
          provider = true;
        } catch {
          /* Local authority is already revoked. */
        }
      }
    }
    return { signed_out: true, provider_signed_out: provider };
  }
  ticket(attempt: string) {
    return (
      attempt +
      "." +
      createHmac("sha256", this.config.secret)
        .update("fyde/oauth/v2:" + attempt)
        .digest("base64url")
    );
  }
  async googleStart(ticket: string) {
    const id = ticket.split(".")[0];
    if (!same(ticket, this.ticket(id)))
      throw new PolicyError(
        "authentication_required",
        "Start Google sign-in again.",
        401,
      );
    const attempt = await this.db.one(
      "NeonOAuthAttempt",
      "id=$1 AND expires_at>now() AND consumed_at IS NULL AND session_id IS NULL",
      [id],
    );
    if (!attempt)
      throw new PolicyError(
        "authentication_required",
        "Google sign-in expired.",
        401,
      );
    const state = random();
    const callbackURL = `${this.config.siteUrl}/auth/google/callback/?state=${encodeURIComponent(state)}`;
    const { response, payload } = await this.call("sign-in/social", {
      provider: "google",
      callbackURL,
      disableRedirect: true,
    });
    const challenge = this.cookies(response, CHALLENGES);
    if (
      !challenge ||
      typeof payload?.url !== "string" ||
      !payload.url.startsWith("https://")
    )
      throw new PolicyError(
        "auth_unavailable",
        "Google sign-in could not start. Please retry.",
        503,
      );
    const pending = this.cipher.encrypt(
      JSON.stringify({ state, challenge, attempt: id, expires: +later(300) }),
    );
    return { url: payload.url, pending };
  }
  async googleFinish(pendingCookie: string, state: string, verifier: string) {
    let pending: Row;
    try {
      pending = JSON.parse(this.cipher.decrypt(pendingCookie));
    } catch {
      throw new PolicyError(
        "authentication_required",
        "Google sign-in expired. Start again.",
        401,
      );
    }
    if (
      !pending.state ||
      !same(pending.state, state) ||
      pending.expires < Date.now() ||
      !verifier ||
      verifier.length > 4096
    )
      throw new PolicyError(
        "authentication_required",
        "Google sign-in expired. Start again.",
        401,
      );
    return this.db.tx(async () => {
      const attempt = await this.db.one(
        "NeonOAuthAttempt",
        "id=$1 AND expires_at>now() AND consumed_at IS NULL AND session_id IS NULL",
        [pending.attempt],
        "FOR UPDATE",
      );
      if (!attempt)
        throw new PolicyError(
          "authentication_required",
          "Sign-in expired or was already used.",
          401,
        );
      const { response } = await this.call(
        "get-session",
        undefined,
        pending.challenge,
        { neon_auth_session_verifier: verifier },
      );
      const session = await this.fromResponse(response),
        code = random();
      await this.db.update(
        "NeonOAuthAttempt",
        { session_id: session.id, code_hash: hash(code) },
        "id=$1",
        [attempt.id],
      );
      return (
        attempt.redirect_uri +
        "?" +
        new URLSearchParams({ code, attempt: attempt.id })
      );
    });
  }
  async exchange(data: Row) {
    const verifier = String(data.code_verifier || "");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
      throw new PolicyError(
        "authentication_required",
        "The sign-in proof is invalid.",
        401,
      );
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return this.db.tx(async () => {
      const attempt = await this.db.one(
        "NeonOAuthAttempt",
        "id=$1 AND expires_at>now() AND consumed_at IS NULL",
        [data.attempt],
        "FOR UPDATE",
      );
      if (
        !attempt?.session_id ||
        !same(attempt.code_challenge, challenge) ||
        !same(attempt.code_hash, hash(String(data.code || "")))
      )
        throw new PolicyError(
          "authentication_required",
          "Sign-in expired or was already used. Start again.",
          401,
        );
      const session = requireValue(
        await this.db.one("NeonSession", "id=$1", [attempt.session_id]),
      );
      const user = requireValue(
        await this.db.one("User", "id=$1", [session.owner_id]),
      );
      await this.validate(session, user);
      await this.db.update(
        "NeonOAuthAttempt",
        { consumed_at: new Date() },
        "id=$1",
        [attempt.id],
      );
      return this.issue(session, String(data.device_name || "Fyde device"));
    });
  }
}
export function profile(user: Row) {
  return {
    id: user.id,
    name: user.first_name,
    email: user.email,
    email_verified: user.email_verified,
    data_mode: user.data_mode,
    onboarding_complete: !!user.onboarding_completed_at,
    default_channel: user.default_delivery_channel,
    sharing_paused: user.sharing_paused,
    chat_context_enabled: user.chat_context_enabled,
  };
}
