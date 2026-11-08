import {
  createHash,
  timingSafeEqual,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
} from "node:crypto";
import type { Database, Row } from "./db.js";
export class PolicyError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 403,
  ) {
    super(message);
  }
}
export function requireValue<T>(
  value: T | null | undefined,
  code = "unavailable",
  message = "This item is unavailable.",
): T {
  if (value == null) throw new PolicyError(code, message, 404);
  return value;
}
export const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const random = () => randomBytes(40).toString("base64url");
export const same = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export const uuid = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new PolicyError(
      "invalid_operation",
      "Supply a unique UUID operation_id and reuse it only for retries.",
      400,
    );
  return value.toLowerCase();
};
export const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
export const normalize = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").trim();
export async function audit(
  db: Database,
  owner: Row,
  event: string,
  objectId = "",
  decision = "",
  detail: Row = {},
) {
  await db.insert("AuditEvent", {
    owner_id: owner.id,
    event_type: event,
    object_id: objectId,
    decision,
    data_mode: owner.data_mode,
    detail,
  });
}
export async function rateLimit(
  db: Database,
  key: string,
  maximum: number,
  seconds: number,
) {
  const values = [hash(key), new Date(), later(-seconds), maximum];
  const result = await db.query(
    `INSERT INTO exchange_ratelimit (key,"window",count) VALUES ($1,$2,1)
    ON CONFLICT (key) DO UPDATE SET "window"=CASE WHEN exchange_ratelimit."window"<$3 THEN $2 ELSE exchange_ratelimit."window" END,
    count=CASE WHEN exchange_ratelimit."window"<$3 THEN 1 ELSE exchange_ratelimit.count+1 END
    WHERE exchange_ratelimit."window"<$3 OR exchange_ratelimit.count<$4 RETURNING count`,
    values,
  );
  if (!result.length)
    throw new PolicyError(
      "rate_limited",
      "Too many attempts. Try again later.",
      429,
    );
}

// Fernet compatibility preserves existing encrypted provider sessions during the runtime migration.
export class SessionCipher {
  private key: Buffer;
  constructor(secret: string) {
    this.key = createHash("sha256")
      .update("fyde/neon-session/v1:" + secret)
      .digest();
  }
  encrypt(text: string) {
    const iv = randomBytes(16),
      time = Buffer.alloc(8);
    time.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
    const aes = createCipheriv("aes-128-cbc", this.key.subarray(16), iv);
    const body = Buffer.concat([
      Buffer.from([0x80]),
      time,
      iv,
      aes.update(text),
      aes.final(),
    ]);
    return Buffer.concat([
      body,
      createHmac("sha256", this.key.subarray(0, 16)).update(body).digest(),
    ]).toString("base64url");
  }
  decrypt(text: string) {
    try {
      const bytes = Buffer.from(text, "base64url"),
        body = bytes.subarray(0, -32);
      if (
        bytes.length < 73 ||
        bytes[0] !== 0x80 ||
        !timingSafeEqual(
          bytes.subarray(-32),
          createHmac("sha256", this.key.subarray(0, 16)).update(body).digest(),
        )
      )
        throw new Error();
      const aes = createDecipheriv(
        "aes-128-cbc",
        this.key.subarray(16),
        bytes.subarray(9, 25),
      );
      return Buffer.concat([
        aes.update(bytes.subarray(25, -32)),
        aes.final(),
      ]).toString();
    } catch {
      throw new PolicyError(
        "authentication_required",
        "Sign in again to continue.",
        401,
      );
    }
  }
}
