import plans from "../../content/plans.json" with { type: "json" };
import type { Database, Row } from "./db.js";
import { PolicyError, hash, requireValue, same } from "./core.js";

export const documentTypes = [
  ["general", "General"],
  ["passport", "Passport"],
  ["visa", "Visa / immigration"],
  ["identity", "Identity"],
  ["financial", "Financial"],
  ["legal", "Legal"],
  ["correspondence", "Correspondence"],
  ["other", "Other"],
];
export const channels = ["in_app", "email", "phone"];
export const canonical = (value: any): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  ).replace(
    /[\u007f-\uffff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
export async function entitlement(db: Database, owner: Row) {
  await db.query(
    `INSERT INTO exchange_subscription (id,created_at,owner_id,plan,plan_version,status,provider_customer_id,provider_subscription_id,period_start,period_end,cancel_at_period_end,data_mode)
    VALUES (gen_random_uuid(),now(),$1,'free','2026-11-07','free','','',NULL,NULL,false,'sandbox') ON CONFLICT(owner_id) DO NOTHING`,
    [owner.id],
  );
  const sub = requireValue(
    await db.one("Subscription", "owner_id=$1", [owner.id]),
  );
  const eligible =
    ["active", "trialing"].includes(sub.status) &&
    sub.period_end > new Date() &&
    sub.data_mode === "live";
  const key =
    eligible && Object.hasOwn(plans.plans, sub.plan)
      ? (sub.plan as keyof typeof plans.plans)
      : "free";
  return { key, plan: plans.plans[key], sub };
}
export async function currentPeriod(db: Database, owner: Row) {
  const { sub } = await entitlement(db, owner),
    now = new Date();
  const active =
    ["active", "trialing"].includes(sub.status) &&
    sub.period_start <= now &&
    now < sub.period_end;
  const start = active
    ? sub.period_start
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = active
    ? sub.period_end
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await db.query(
    `INSERT INTO exchange_usageperiod (id,created_at,owner_id,starts_at,ends_at,reserved,consumed,bandwidth_reserved,bandwidth_used,data_mode)
    VALUES (gen_random_uuid(),now(),$1,$2,$3,0,0,0,0,$4) ON CONFLICT(owner_id,starts_at,data_mode) DO NOTHING`,
    [owner.id, start, end, owner.data_mode],
  );
  return requireValue(
    await db.one(
      "UsagePeriod",
      "owner_id=$1 AND starts_at=$2 AND data_mode=$3",
      [owner.id, start, owner.data_mode],
    ),
  );
}
export async function reserve(db: Database, owner: Row) {
  const period = await currentPeriod(db, owner),
    { plan } = await entitlement(db, owner);
  const changed = await db.query(
    `UPDATE exchange_usageperiod SET reserved=reserved+1 WHERE id=$1 AND ($2::integer IS NULL OR reserved+consumed<$2) RETURNING id`,
    [period.id, plan.sends],
  );
  if (!changed.length)
    throw new PolicyError(
      "quota_exceeded",
      "Your monthly allowance is used or reserved by queued sends.",
    );
  return period;
}
export async function settle(db: Database, transfer: Row, accepted: boolean) {
  if (transfer.quota_state !== "reserved") return;
  const result = await db.query(
    `UPDATE exchange_transfer SET quota_state=$2 WHERE id=$1 AND quota_state='reserved' RETURNING id`,
    [transfer.id, accepted ? "consumed" : "released"],
  );
  if (!result.length) return;
  await db.query(
    "UPDATE exchange_usageperiod SET reserved=greatest(0,reserved-1),consumed=consumed+$2 WHERE id=$1",
    [transfer.usage_period_id, accepted ? 1 : 0],
  );
  await db.insert("UsageEntry", {
    owner_id: transfer.owner_id,
    transfer_id: transfer.id,
    kind: accepted ? "accepted" : "released",
    units: accepted ? 1 : 0,
    data_mode: transfer.data_mode,
  });
  transfer.quota_state = accepted ? "consumed" : "released";
}
export async function accountFor(
  db: Database,
  contact: Row,
  mode: string,
  kind: string,
) {
  const users =
    kind === "phone"
      ? contact.phone &&
        (await db.rows(
          "User",
          "is_active AND data_mode=$1 AND phone=$2 AND phone_verified_at IS NOT NULL",
          [mode, contact.phone],
        ))
      : contact.email &&
        (await db.rows(
          "User",
          "is_active AND data_mode=$1 AND lower(email)=$2 AND email_verified",
          [mode, contact.email.toLowerCase()],
        ));
  return users && users.length === 1 ? users[0] : undefined;
}
export async function refreshContact(db: Database, contact: Row, mode: string) {
  const values: Row = {};
  if (!contact.verified_at && (await accountFor(db, contact, mode, "email")))
    values.verified_at = new Date();
  if (
    !contact.phone_verified_at &&
    (await accountFor(db, contact, mode, "phone"))
  )
    values.phone_verified_at = new Date();
  if (Object.keys(values).length)
    return (await db.update("Contact", values, "id=$1", [contact.id]))[0];
  return contact;
}
export async function resolveRecipient(
  db: Database,
  contact: Row,
  mode: string,
) {
  const email = await accountFor(db, contact, mode, "email"),
    phone = await accountFor(db, contact, mode, "phone");
  if (email && phone && email.id !== phone.id)
    throw new PolicyError(
      "recipient_identity_conflict",
      "This contact's email and phone identify different Fyde accounts. Update the contact before sending.",
    );
  if (email) return { user: email, kind: "email" };
  if (phone) return { user: phone, kind: "phone" };
  throw new PolicyError(
    "recipient_not_on_fyde",
    "This contact needs a verified Fyde account for in-app delivery.",
  );
}
export async function loadVersion(db: Database, id: string) {
  const v = requireValue(await db.one("FileVersion", "id=$1", [id]));
  v.document = requireValue(await db.one("Document", "id=$1", [v.document_id]));
  v.document.matter = v.document.matter_id
    ? await db.one("Matter", "id=$1", [v.document.matter_id])
    : null;
  return v;
}
export async function loadPolicy(db: Database, id: string, lock = false) {
  const p = requireValue(
    await db.one("StandingPolicy", "id=$1", [id], lock ? "FOR UPDATE" : ""),
  );
  p.owner = requireValue(await db.one("User", "id=$1", [p.owner_id]));
  p.contact = requireValue(await db.one("Contact", "id=$1", [p.contact_id]));
  p.recipient = requireValue(await db.one("User", "id=$1", [p.recipient_id]));
  p.matter = requireValue(await db.one("Matter", "id=$1", [p.matter_id]));
  return p;
}
export async function checkPolicy(
  db: Database,
  p: Row,
  requester?: Row,
  version?: Row,
) {
  if (
    p.revoked_at ||
    p.expires_at <= new Date() ||
    p.owner.sharing_paused ||
    p.contact.paused ||
    !p.owner.is_active ||
    !p.owner.email_verified ||
    p.contact.owner_id !== p.owner_id ||
    p.matter.owner_id !== p.owner_id ||
    p.endpoint_revision !== p.contact.endpoint_revision ||
    p.data_mode !== p.owner.data_mode ||
    p.data_mode !== p.recipient.data_mode
  )
    throw new PolicyError(
      "permission_unavailable",
      "This case permission is paused, expired, changed or unavailable.",
    );
  const verified = await accountFor(
    db,
    p.contact,
    p.data_mode,
    p.identity_kind,
  );
  if (
    !verified ||
    verified.id !== p.recipient_id ||
    (requester && requester.id !== verified.id) ||
    !channels.includes(p.channel) ||
    !["email", "phone"].includes(p.identity_kind) ||
    (p.channel !== "in_app" && p.channel !== p.identity_kind)
  )
    throw new PolicyError(
      "permission_unavailable",
      "This case permission is unavailable for this verified account.",
    );
  if (version) {
    const d = version.document,
      initial = p.initial_versions[d.id];
    if (
      d.owner_id !== p.owner_id ||
      d.matter_id !== p.matter_id ||
      d.deleted_at ||
      (!p.document_types.includes("*") &&
        !p.document_types.includes(d.document_type)) ||
      (d.sensitive && !p.include_sensitive) ||
      (!initial && !p.include_future_files) ||
      (!p.include_future_versions &&
        version.id !== initial &&
        (initial || version.number !== 1))
    )
      throw new PolicyError(
        "outside_case_scope",
        "This version is outside the owner's case permission.",
      );
  }
}
export async function loadTransfer(db: Database, id: string, lock = false) {
  const t = requireValue(
    await db.one("Transfer", "id=$1", [id], lock ? "FOR UPDATE" : ""),
  );
  t.owner = requireValue(await db.one("User", "id=$1", [t.owner_id]));
  t.contact = requireValue(await db.one("Contact", "id=$1", [t.contact_id]));
  t.grant = requireValue(await db.one("Grant", "id=$1", [t.grant_id]));
  t.version = await loadVersion(db, t.version_id);
  t.precise_expiry = (
    await db.query(
      `SELECT replace(to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),'.000000','')||'+00:00' AS value FROM exchange_transfer WHERE id=$1`,
      [t.id],
    )
  )[0].value;
  return t;
}
export function executionBinding(t: Row) {
  const expiry =
    t.precise_expiry ||
    (t.expires_at as Date)
      .toISOString()
      .replace(/\.(\d{3})Z$/, (_: string, ms: string) =>
        ms === "000" ? "+00:00" : `.${ms}000+00:00`,
      );
  const values = [
    String(t.owner_id),
    t.version_id,
    t.version.sha256,
    t.contact_id,
    t.contact.email.toLowerCase(),
    String(t.contact.endpoint_revision),
    t.recipient_email.toLowerCase(),
    String(t.endpoint_revision_snapshot),
    t.grant_id,
    String(t.grant.revision),
    t.operation_id,
    expiry,
    "email",
  ];
  if (t.binding_version >= 2)
    values.push(
      t.channel,
      t.recipient_phone,
      t.grant.identity_kind,
      t.contact.phone,
    );
  if (t.binding_version >= 3)
    values.push(
      t.grant.standing_policy_id || "",
      String(t.grant.policy_revision),
    );
  return hash(canonical(values));
}
export async function checkGrant(
  db: Database,
  g: Row,
  owner: Row,
  contact: Row,
  version: Row,
) {
  if (g.standing_policy_id) {
    const p = await loadPolicy(db, g.standing_policy_id);
    await checkPolicy(db, p, undefined, version);
    if (
      g.policy_revision !== p.revision ||
      g.owner_id !== p.owner_id ||
      g.contact_id !== p.contact_id ||
      g.channel !== p.channel ||
      g.identity_kind !== p.identity_kind
    )
      throw new PolicyError(
        "binding_changed",
        "This case permission changed. Create a new transfer.",
      );
  }
  if (
    g.owner_id !== owner.id ||
    contact.owner_id !== owner.id ||
    version.document.owner_id !== owner.id ||
    g.contact_id !== contact.id ||
    g.version_id !== version.id
  )
    throw new PolicyError("denied", "This sharing permission is unavailable.");
  if (owner.sharing_paused || contact.paused || !owner.is_active)
    throw new PolicyError("paused", "Sharing is paused.");
  if (!owner.email_verified)
    throw new PolicyError(
      "owner_verification_required",
      "Verify your email before sharing.",
    );
  const verified =
    g.identity_kind === "phone"
      ? contact.phone && contact.phone_verified_at
      : contact.email && contact.verified_at;
  if (!verified || g.endpoint_revision !== contact.endpoint_revision)
    throw new PolicyError(
      "verification_required",
      "The recipient must verify their current contact endpoint.",
    );
  if (g.revoked_at || g.expires_at <= new Date())
    throw new PolicyError(
      "revoked_or_expired",
      "This sharing permission has expired or been revoked.",
    );
  if (version.document.deleted_at || version.state !== "ready")
    throw new PolicyError(
      "quarantined",
      "This file has not passed the configured safety checks.",
    );
  if (version.document.sensitive && !g.sensitive_authorized)
    throw new PolicyError(
      "owner_authorization_required",
      "Sensitive files need an explicit permission.",
    );
  if (
    !channels.includes(g.channel) ||
    !["email", "phone"].includes(g.identity_kind) ||
    (g.channel !== "in_app" && g.channel !== g.identity_kind)
  )
    throw new PolicyError(
      "binding_changed",
      "The permission does not match the selected channel.",
    );
}
export async function checkTransfer(db: Database, t: Row) {
  if (
    ![1, 2, 3].includes(t.binding_version) ||
    (t.grant.standing_policy_id && t.binding_version < 3) ||
    t.data_mode !== t.owner.data_mode
  )
    throw new PolicyError(
      "binding_changed",
      "This transfer uses an unavailable binding.",
    );
  await checkGrant(db, t.grant, t.owner, t.contact, t.version);
  if (
    t.channel !== t.grant.channel ||
    (t.binding_version === 1 &&
      (t.channel !== "email" ||
        t.recipient_phone ||
        t.grant.identity_kind !== "email"))
  )
    throw new PolicyError("binding_changed", "The delivery channel changed.");
  if (t.revoked_at || t.expires_at <= new Date())
    throw new PolicyError(
      "revoked_or_expired",
      "This transfer has expired or been revoked.",
    );
  if (!same(t.binding, executionBinding(t)))
    throw new PolicyError(
      "binding_changed",
      "The file, recipient, or permission changed. Create a new transfer.",
    );
}
export function matchesRecipient(user: Row, t: Row) {
  return (
    user.is_active &&
    user.data_mode === t.data_mode &&
    (t.grant.identity_kind === "phone"
      ? !!user.phone &&
        !!user.phone_verified_at &&
        user.phone === t.recipient_phone
      : user.email_verified &&
        user.email.toLowerCase() === t.recipient_email.toLowerCase())
  );
}
export async function canDownload(db: Database, user: Row, t: Row) {
  const item = await db.one("InboxItem", "recipient_id=$1 AND transfer_id=$2", [
    user.id,
    t.id,
  ]);
  if (!item || !matchesRecipient(user, t))
    throw new PolicyError(
      "denied",
      "This file is unavailable for this account.",
    );
  await checkTransfer(db, t);
  return item;
}
export function fileCard(v: Row) {
  return {
    id: v.id,
    document_id: v.document_id,
    title: v.document.title,
    name: v.original_name,
    number: v.number,
    size: Number(v.size),
    state: v.state,
    document_type: v.document.document_type,
    matter: v.document.matter?.name || "",
    matter_id: v.document.matter_id || "",
    sensitive: v.document.sensitive,
    url: `/files?document=${v.document_id}`,
    api_download_url: `/api/v1/files/${v.id}/download/`,
  };
}
export function contactCard(c: Row) {
  return {
    id: c.id,
    name: c.name,
    relationship: c.relationship,
    endpoint: c.email || c.phone,
  };
}
export function policyCard(p: Row) {
  return {
    id: p.id,
    data_mode: p.data_mode,
    matter_id: p.matter_id,
    case: p.matter.name,
    contact_id: p.contact_id,
    contact: p.contact.name,
    owner: p.owner.first_name || "File owner",
    types: p.document_types,
    future_files: p.include_future_files,
    future_versions: p.include_future_versions,
    sensitive: p.include_sensitive,
    expires_at: p.expires_at.toISOString(),
    channel: p.channel,
    used: p.requests_used,
    limit: p.max_requests,
    revoked: !!p.revoked_at,
    recipient_changed: p.endpoint_revision !== p.contact.endpoint_revision,
  };
}
