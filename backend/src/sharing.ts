import { randomUUID } from "node:crypto";
import type { Database, Row } from "./db.js";
import { PolicyError, audit, hash, later, requireValue } from "./core.js";
import {
  accountFor,
  canDownload,
  canonical,
  channels,
  checkGrant,
  checkPolicy,
  checkTransfer,
  contactCard,
  currentPeriod,
  documentTypes,
  entitlement,
  executionBinding,
  fileCard,
  loadPolicy,
  loadTransfer,
  loadVersion,
  matchesRecipient,
  policyCard,
  refreshContact,
  reserve,
  resolveRecipient,
  settle,
} from "./policy.js";
import { profile } from "./auth.js";

export class Sharing {
  constructor(readonly db: Database) {}
  async workspace(owner: Row) {
    const docs = await this.db.rows(
      "Document",
      "owner_id=$1 AND deleted_at IS NULL",
      [owner.id],
      "ORDER BY created_at DESC LIMIT 1000",
    );
    const files = [];
    for (const doc of docs)
      if (doc.current_version_id)
        files.push(
          fileCard(await loadVersion(this.db, doc.current_version_id)),
        );
    const contacts = [];
    for (let c of await this.db.rows(
      "Contact",
      "owner_id=$1",
      [owner.id],
      "ORDER BY name LIMIT 1000",
    )) {
      c = await refreshContact(this.db, c, owner.data_mode);
      contacts.push({
        ...contactCard(c),
        email: c.email,
        phone: c.phone,
        verified: !!(c.verified_at || c.phone_verified_at),
        aliases: c.aliases,
      });
    }
    const policies = [];
    for (const p of await this.db.rows(
      "StandingPolicy",
      "owner_id=$1",
      [owner.id],
      "LIMIT 1000",
    ))
      policies.push(policyCard(await loadPolicy(this.db, p.id)));
    const received_permissions = [];
    for (const p of await this.peerPolicies(owner))
      received_permissions.push(policyCard(p));
    return {
      user: profile(owner),
      files,
      contacts,
      matters: (await this.db.rows("Matter", "owner_id=$1", [owner.id])).map(
        (m) => ({ id: m.id, name: m.name }),
      ),
      document_types: documentTypes.map(([id, name]) => ({ id, name })),
      policies,
      received_permissions,
      plan: (await entitlement(this.db, owner)).plan,
      consumed: (await currentPeriod(this.db, owner)).consumed,
    };
  }
  async peerPolicies(owner: Row) {
    const result = [];
    for (const row of await this.db.rows(
      "StandingPolicy",
      "recipient_id=$1 AND revoked_at IS NULL AND expires_at>now() AND data_mode=$2",
      [owner.id, owner.data_mode],
      "LIMIT 1000",
    )) {
      const p = await loadPolicy(this.db, row.id);
      try {
        await checkPolicy(this.db, p, owner);
        result.push(p);
      } catch (e) {
        if (!(e instanceof PolicyError)) throw e;
      }
    }
    return result;
  }
  async contact(owner: Row, data: Row, id?: string) {
    return this.db.tx(async () => {
      const prior = id
        ? requireValue(
            await this.db.one(
              "Contact",
              "id=$1 AND owner_id=$2",
              [id, owner.id],
              "FOR UPDATE",
            ),
          )
        : undefined;
      const value = { ...prior, ...data };
      const name = String(value.name || "").trim(),
        email = String(value.email || "")
          .trim()
          .toLowerCase(),
        phone = String(value.phone || "")
          .trim()
          .replace(/[ ()-]/g, "");
      if (
        !name ||
        name.length > 120 ||
        (!email && !phone) ||
        (email &&
          (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) ||
        (phone && !/^\+[1-9]\d{7,14}$/.test(phone))
      )
        throw new PolicyError(
          "invalid_contact",
          "Use a name and a valid email address or phone number with country code.",
          400,
        );
      const fields: Row = {
        name,
        email,
        phone,
        relationship: String(value.relationship || "").slice(0, 80),
        aliases: String(value.aliases || "").slice(0, 250),
      };
      let contact: Row;
      if (prior) {
        if (prior.email.toLowerCase() !== email || prior.phone !== phone) {
          fields.endpoint_revision = prior.endpoint_revision + 1;
          fields.verified_at = null;
          fields.phone_verified_at = null;
          await this.db.query(
            "UPDATE exchange_grant SET revoked_at=now(),revision=revision+1 WHERE contact_id=$1 AND revoked_at IS NULL",
            [prior.id],
          );
        }
        [contact] = await this.db.update("Contact", fields, "id=$1", [
          prior.id,
        ]);
      } else
        contact = await this.db.insert("Contact", {
          ...fields,
          owner_id: owner.id,
        });
      contact = await refreshContact(this.db, contact, owner.data_mode);
      await audit(
        this.db,
        owner,
        "contact.details_updated",
        contact.id,
        "owner_updated",
      );
      return contactCard(contact);
    });
  }
  async matter(owner: Row, name: unknown, id?: string) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120)
      throw new PolicyError(
        "invalid_case",
        "Give this case a name of up to 120 characters.",
        400,
      );
    return this.db.tx(async () => {
      await this.db.one("User", "id=$1", [owner.id], "FOR UPDATE");
      const existing = await this.db.one(
        "Matter",
        "owner_id=$1 AND lower(name)=lower($2::text)",
        [owner.id, name.trim()],
      );
      if (id) {
        if (existing && existing.id !== id)
          throw new PolicyError("invalid_case", "Choose a unique case name.");
        return requireValue(
          (
            await this.db.update(
              "Matter",
              { name: name.trim() },
              "id=$1 AND owner_id=$2",
              [id, owner.id],
            )
          )[0],
        );
      }
      return (
        existing ||
        this.db.insert("Matter", { owner_id: owner.id, name: name.trim() })
      );
    });
  }
  async createPolicy(owner: Row, data: Row, operation: string) {
    return this.db.tx(async () => {
      owner = requireValue(
        await this.db.one("User", "id=$1", [owner.id], "FOR UPDATE"),
      );
      if (data.confirm !== true)
        throw new PolicyError(
          "owner_consent_required",
          "Review the case scope and explicitly enable automatic sharing.",
        );
      const days = data.days ?? 90,
        limit = data.max_requests ?? 100,
        channel = data.channel ?? "in_app";
      if (
        !Number.isInteger(days) ||
        days < 1 ||
        days > 365 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 1000 ||
        !channels.includes(channel)
      )
        throw new PolicyError(
          "invalid_limits",
          "Choose 1–365 days, 1–1,000 requests, and a supported channel.",
          400,
        );
      if (!owner.email_verified || owner.sharing_paused)
        throw new PolicyError(
          "owner_verification_required",
          "Verify your email and resume sharing first.",
        );
      let contact = requireValue(
        await this.db.one("Contact", "id=$1 AND owner_id=$2", [
          data.contact_id,
          owner.id,
        ]),
      );
      const matter = requireValue(
        await this.db.one("Matter", "id=$1 AND owner_id=$2", [
          data.matter_id,
          owner.id,
        ]),
      );
      contact = await refreshContact(this.db, contact, owner.data_mode);
      const resolved = await resolveRecipient(
        this.db,
        contact,
        owner.data_mode,
      );
      let kind = resolved.kind;
      if (channel !== "in_app") {
        const target = await accountFor(
          this.db,
          contact,
          owner.data_mode,
          channel,
        );
        if (!target || target.id !== resolved.user.id)
          throw new PolicyError(
            "verification_required",
            "The selected channel must identify the same verified recipient.",
          );
        kind = channel;
      }
      const types = this.types(data.types ?? ["*"]);
      const expected = [
        contact.id,
        matter.id,
        types,
        channel,
        data.future_files === true,
        data.future_versions === true,
        data.sensitive === true,
        limit,
        days,
      ];
      const existing = await this.db.one(
        "StandingPolicy",
        "owner_id=$1 AND operation_id=$2",
        [owner.id, operation],
      );
      if (existing) {
        const actual = [
          existing.contact_id,
          existing.matter_id,
          existing.document_types,
          existing.channel,
          existing.include_future_files,
          existing.include_future_versions,
          existing.include_sensitive,
          existing.max_requests,
          Math.round((+existing.expires_at - +existing.created_at) / 86400000),
        ];
        if (canonical(expected) !== canonical(actual))
          throw new PolicyError(
            "idempotency_conflict",
            "This operation already created a different permission.",
            409,
          );
        return loadPolicy(this.db, existing.id);
      }
      const initial: Row = {};
      for (const d of await this.db.rows(
        "Document",
        "owner_id=$1 AND matter_id=$2 AND deleted_at IS NULL AND current_version_id IS NOT NULL",
        [owner.id, matter.id],
      ))
        initial[d.id] = d.current_version_id;
      const p = await this.db.insert("StandingPolicy", {
        owner_id: owner.id,
        contact_id: contact.id,
        recipient_id: resolved.user.id,
        matter_id: matter.id,
        operation_id: operation,
        endpoint_revision: contact.endpoint_revision,
        identity_kind: kind,
        channel,
        data_mode: owner.data_mode,
        document_types: types,
        initial_versions: initial,
        include_future_files: data.future_files === true,
        include_future_versions: data.future_versions === true,
        include_sensitive: data.sensitive === true,
        expires_at: later(days * 86400),
        max_requests: limit,
      });
      const loaded = await loadPolicy(this.db, p.id);
      await checkPolicy(this.db, loaded);
      await audit(
        this.db,
        owner,
        "case_permission.enabled",
        p.id,
        "owner_authorized",
        { recipient_id: resolved.user.id },
      );
      return loaded;
    });
  }
  types(value: unknown): string[] {
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > 12 ||
      !value.every(
        (v) =>
          typeof v === "string" &&
          (v === "*" || documentTypes.some(([k]) => k === v)),
      )
    )
      throw new PolicyError(
        "invalid_types",
        "Choose supported document types.",
        400,
      );
    return value.includes("*") ? ["*"] : [...new Set(value)].sort();
  }
  async createTransfer(
    owner: Row,
    versionId: string,
    contactId: string,
    operation: string,
    channel?: string,
    grant?: Row,
  ) {
    return this.db.tx(async () => {
      owner = requireValue(
        await this.db.one("User", "id=$1", [owner.id], "FOR UPDATE"),
      );
      channel = channel || grant?.channel || owner.default_delivery_channel;
      if (!channels.includes(channel!))
        throw new PolicyError(
          "unsupported_channel",
          "Choose Fyde, email, or phone delivery.",
        );
      const existing = await this.db.one(
        "Transfer",
        "owner_id=$1 AND operation_id=$2",
        [owner.id, operation],
      );
      if (existing) {
        if (
          existing.version_id !== versionId ||
          existing.contact_id !== contactId ||
          existing.channel !== channel ||
          (grant && existing.grant_id !== grant.id)
        )
          throw new PolicyError(
            "idempotency_conflict",
            "This operation ID was already used for a different transfer.",
            409,
          );
        return existing;
      }
      const version = await loadVersion(this.db, versionId);
      if (version.document.owner_id !== owner.id)
        throw new PolicyError("unavailable", "The file is unavailable.", 404);
      let contact = requireValue(
        await this.db.one(
          "Contact",
          "id=$1 AND owner_id=$2",
          [contactId, owner.id],
          "FOR UPDATE",
        ),
      );
      contact = await refreshContact(this.db, contact, owner.data_mode);
      // Disconnected external channels remain explicit, with no quota or provider side effect.
      if (channel !== "in_app")
        throw new PolicyError(
          channel === "phone" ? "sms_disabled" : "email_disabled",
          `${channel === "phone" ? "SMS" : "Email"} delivery is not connected. Use the verified Fyde inbox.`,
        );
      const target = await resolveRecipient(this.db, contact, owner.data_mode);
      let kind = target.kind;
      if (grant) {
        grant = requireValue(
          await this.db.one(
            "Grant",
            "id=$1 AND owner_id=$2",
            [grant.id, owner.id],
            "FOR UPDATE",
          ),
        );
        const bound = await accountFor(
          this.db,
          contact,
          owner.data_mode,
          grant.identity_kind,
        );
        if (!bound || bound.id !== target.user.id)
          throw new PolicyError(
            "recipient_identity_changed",
            "Verify the recipient covered by this permission.",
          );
        kind = grant.identity_kind;
      }
      if (!grant && version.document.sensitive) {
        grant = await this.db.one(
          "Grant",
          "owner_id=$1 AND contact_id=$2 AND version_id=$3 AND sensitive_authorized AND requests_used<max_requests AND channel=$4 AND identity_kind=$5 AND revoked_at IS NULL AND expires_at>now()",
          [owner.id, contact.id, version.id, channel, kind],
          "FOR UPDATE",
        );
        if (!grant && version.document.matter_id)
          for (const row of await this.db.rows(
            "StandingPolicy",
            "owner_id=$1 AND contact_id=$2 AND matter_id=$3 AND channel=$4 AND identity_kind=$5 AND include_sensitive AND revoked_at IS NULL AND expires_at>now()",
            [owner.id, contact.id, version.document.matter_id, channel, kind],
          )) {
            const p = await loadPolicy(this.db, row.id);
            try {
              await checkPolicy(this.db, p, undefined, version);
            } catch (e) {
              if (e instanceof PolicyError) continue;
              throw e;
            }
            grant = await this.db.insert("Grant", {
              owner_id: owner.id,
              contact_id: contact.id,
              version_id: version.id,
              standing_policy_id: p.id,
              policy_revision: p.revision,
              endpoint_revision: contact.endpoint_revision,
              kind: "case",
              purpose: p.matter.name.slice(0, 150),
              sensitive_authorized: true,
              expires_at: p.expires_at,
              channel,
              identity_kind: kind,
            });
            break;
          }
        if (!grant)
          throw new PolicyError(
            "owner_authorization_required",
            "Create an explicit permission for this sensitive file first.",
          );
      }
      if (!grant)
        grant = await this.db.insert("Grant", {
          owner_id: owner.id,
          contact_id: contact.id,
          version_id: version.id,
          endpoint_revision: contact.endpoint_revision,
          expires_at: later(86400),
          channel,
          identity_kind: kind,
        });
      if (grant.channel !== channel || grant.identity_kind !== kind)
        throw new PolicyError(
          "channel_not_authorized",
          "This permission does not allow the selected channel.",
        );
      await checkGrant(this.db, grant, owner, contact, version);
      if (grant.requests_used >= grant.max_requests)
        throw new PolicyError(
          "grant_limit",
          "This permission has reached its request limit.",
        );
      const period = await reserve(this.db, owner);
      await this.db.query(
        "UPDATE exchange_grant SET requests_used=requests_used+1 WHERE id=$1",
        [grant.id],
      );
      const values: Row = {
        owner_id: owner.id,
        contact_id: contact.id,
        version_id: version.id,
        grant_id: grant.id,
        operation_id: operation,
        data_mode: owner.data_mode,
        channel,
        binding_version: 3,
        recipient_phone: contact.phone,
        usage_period_id: period.id,
        recipient_email: contact.email,
        endpoint_revision_snapshot: contact.endpoint_revision,
        expires_at: new Date(Math.min(+later(86400), +grant.expires_at)),
      };
      values.binding = executionBinding({ ...values, grant, version, contact });
      const record = await this.db.insert("Transfer", values);
      const loaded = await loadTransfer(this.db, record.id);
      await this.deliver(loaded, target.user);
      await audit(this.db, owner, "transfer.authorized", record.id, "allow", {
        grant_id: grant.id,
        version_id: version.id,
      });
      return requireValue(await this.db.one("Transfer", "id=$1", [record.id]));
    });
  }
  async deliver(t: Row, recipient?: Row) {
    await checkTransfer(this.db, t);
    recipient =
      recipient ||
      (await accountFor(
        this.db,
        t.contact,
        t.data_mode,
        t.grant.identity_kind,
      ));
    if (!recipient || !matchesRecipient(recipient, t)) return;
    const prior = await this.db.one("InboxItem", "transfer_id=$1", [t.id]);
    if (prior && prior.recipient_id !== recipient.id)
      throw new PolicyError(
        "recipient_identity_changed",
        "This delivery is bound to another verified account.",
      );
    if (!prior) {
      await this.db.insert("InboxItem", {
        transfer_id: t.id,
        recipient_id: recipient.id,
      });
      await settle(this.db, t, true);
      await this.db.update(
        "Transfer",
        {
          accepted_at: t.accepted_at || new Date(),
          status: t.accessed_at ? "accessed" : "available_in_app",
        },
        "id=$1",
        [t.id],
      );
      await this.db.insert("Notification", {
        owner_id: recipient.id,
        external_id: `received/${t.id}`,
        body: "A shared file is available in your Fyde inbox.",
        link: "/received",
      });
      await audit(
        this.db,
        t.owner,
        "transfer.inbox_delivered",
        t.id,
        "verified_recipient_account",
      );
    }
  }
  async revoke(owner: Row, id: string) {
    return this.db.tx(async () => {
      const t = requireValue(
        await this.db.one(
          "Transfer",
          "id=$1 AND owner_id=$2",
          [id, owner.id],
          "FOR UPDATE",
        ),
      );
      const uncertain = await this.db.one(
        "Mail",
        "transfer_id=$1 AND status IN ('sending','uncertain','reconciliation_required')",
        [id],
      );
      if (!uncertain) await settle(this.db, t, false);
      else
        await this.db.query(
          "UPDATE exchange_mail SET status='reconciliation_required' WHERE transfer_id=$1 AND status IN ('sending','uncertain')",
          [id],
        );
      await this.db.update(
        "Transfer",
        {
          revoked_at: new Date(),
          status: "revoked",
          failure_code: uncertain
            ? "revoked_with_uncertain_provider_outcome"
            : t.failure_code,
        },
        "id=$1",
        [id],
      );
      await this.db.query(
        "UPDATE exchange_mail SET status='canceled' WHERE transfer_id=$1 AND status IN ('queued','retry','blocked')",
        [id],
      );
      await audit(this.db, owner, "transfer.revoked", id, "deny");
      return { revoked: true };
    });
  }
  async revokePolicy(owner: Row, id: string) {
    return this.db.tx(async () => {
      const p = requireValue(
        await this.db.one(
          "StandingPolicy",
          "id=$1 AND owner_id=$2",
          [id, owner.id],
          "FOR UPDATE",
        ),
      );
      await this.db.update(
        "StandingPolicy",
        { revoked_at: new Date(), revision: p.revision + 1 },
        "id=$1",
        [id],
      );
      const transfers = await this.db.query(
        "SELECT t.id FROM exchange_transfer t JOIN exchange_grant g ON g.id=t.grant_id WHERE g.standing_policy_id=$1",
        [id],
      );
      for (const t of transfers) await this.revoke(owner, t.id);
      await audit(this.db, owner, "case_permission.revoked", id, "deny");
      return { revoked: true };
    });
  }
  async collect(owner: Row) {
    const ids = await this.db.query(
      `SELECT t.id FROM exchange_transfer t JOIN exchange_grant g ON g.id=t.grant_id LEFT JOIN exchange_inboxitem i ON i.transfer_id=t.id
      WHERE i.id IS NULL AND t.data_mode=$1 AND t.revoked_at IS NULL AND t.expires_at>now() AND t.status IN ('provider_accepted','delivered','test_available','available_in_app','accessed')
      AND ((g.identity_kind='email' AND $3 AND lower(t.recipient_email)=lower($2::text)) OR (g.identity_kind='phone' AND $5 AND t.recipient_phone=$4)) LIMIT 100`,
      [
        owner.data_mode,
        owner.email,
        owner.email_verified,
        owner.phone,
        !!owner.phone_verified_at,
      ],
    );
    for (const { id } of ids)
      try {
        await this.db.tx(async () =>
          this.deliver(await loadTransfer(this.db, id, true), owner),
        );
      } catch (e) {
        if (!(e instanceof PolicyError)) throw e;
      }
  }
  async received(owner: Row, policyId?: string) {
    await this.collect(owner);
    const items = await this.db.rows(
        "InboxItem",
        "recipient_id=$1",
        [owner.id],
        "ORDER BY created_at DESC LIMIT 100",
      ),
      result = [];
    for (const item of items) {
      const t = await loadTransfer(this.db, item.transfer_id);
      if (policyId && t.grant.standing_policy_id !== policyId) continue;
      let available = true;
      try {
        await canDownload(this.db, owner, t);
      } catch (e) {
        if (!(e instanceof PolicyError)) throw e;
        available = false;
      }
      result.push({
        ...fileCard(t.version),
        item_id: item.id,
        from: t.owner.first_name || "File owner",
        available,
        expires_at: t.expires_at.toISOString(),
        download_url: `/api/v1/received/${item.id}/download/`,
        api_download_url: `/api/v1/received/${item.id}/download/`,
      });
    }
    return result;
  }
  async fulfill(
    requester: Row,
    policyId: string,
    operation: string,
    data: Row,
  ) {
    return this.db.tx(async () => {
      const p = await loadPolicy(this.db, policyId, true);
      if (p.recipient_id !== requester.id)
        throw new PolicyError(
          "permission_unavailable",
          "This case permission is unavailable.",
        );
      await checkPolicy(this.db, p, requester);
      const types = this.types(data.types ?? ["*"]),
        query = String(data.query || "")
          .trim()
          .toLowerCase(),
        after = String(data.after || "");
      if (query.length > 180 || after.length > 36)
        throw new PolicyError(
          "invalid_request",
          "Use a short filename or document type.",
          400,
        );
      const fingerprint = hash(canonical([p.id, types, query, after])),
        existing = await this.db.one(
          "CaseRequest",
          "requester_id=$1 AND operation_id=$2",
          [requester.id, operation],
        );
      if (existing) {
        if (existing.input_hash !== fingerprint)
          throw new PolicyError(
            "idempotency_conflict",
            "This operation was used for a different document request.",
            409,
          );
        return existing;
      }
      if (p.requests_used >= p.max_requests)
        throw new PolicyError(
          "request_limit",
          "This permission has reached its automatic request limit.",
        );
      const record = await this.db.insert("CaseRequest", {
          requester_id: requester.id,
          policy_id: p.id,
          operation_id: operation,
          input_hash: fingerprint,
        }),
        selected = [];
      for (const d of await this.db.rows(
        "Document",
        "owner_id=$1 AND matter_id=$2 AND deleted_at IS NULL AND id::text>$3",
        [p.owner_id, p.matter_id, after],
        "ORDER BY id LIMIT 1000",
      )) {
        const initial = p.initial_versions[d.id];
        let id = p.include_future_versions ? d.current_version_id : initial;
        if (!id && !initial && p.include_future_files)
          id = (
            await this.db.one("FileVersion", "document_id=$1 AND number=1", [
              d.id,
            ])
          )?.id;
        if (!id) continue;
        const v = await loadVersion(this.db, id);
        if (
          v.state !== "ready" ||
          (!types.includes("*") && !types.includes(d.document_type)) ||
          (query &&
            !`${d.title} ${v.original_name}`.toLowerCase().includes(query))
        )
          continue;
        try {
          await checkPolicy(this.db, p, undefined, v);
          selected.push(v);
        } catch (e) {
          if (!(e instanceof PolicyError)) throw e;
        }
      }
      const page = selected.slice(0, 10),
        outcomes = [];
      for (const [index, v] of page.entries())
        try {
          const t = await this.db.tx(async () => {
            const g = await this.db.insert("Grant", {
              owner_id: p.owner_id,
              contact_id: p.contact_id,
              version_id: v.id,
              standing_policy_id: p.id,
              policy_revision: p.revision,
              endpoint_revision: p.endpoint_revision,
              kind: "case",
              purpose: p.matter.name.slice(0, 150),
              sensitive_authorized: p.include_sensitive,
              expires_at: p.expires_at,
              channel: p.channel,
              identity_kind: p.identity_kind,
            });
            return this.createTransfer(
              p.owner,
              v.id,
              p.contact_id,
              `case/${record.id}/${index}`,
              p.channel,
              g,
            );
          });
          outcomes.push({ transfer_id: t.id, state: t.status });
        } catch (e) {
          if (!(e instanceof PolicyError)) throw e;
          outcomes.push({
            state: [
              "quota_exceeded",
              "paused",
              "mode_changed",
              "sms_disabled",
              "email_disabled",
            ].includes(e.code)
              ? e.code
              : "unavailable",
          });
        }
      if (page.length)
        await this.db.query(
          "UPDATE exchange_standingpolicy SET requests_used=requests_used+1 WHERE id=$1",
          [p.id],
        );
      const result = {
        request_id: record.id,
        outcomes,
        next_cursor: selected.length > 10 ? page.at(-1)!.document_id : null,
        message: outcomes.length
          ? "The owner's case permission was applied automatically."
          : "No available documents match this permission and request.",
      };
      await this.db.update("CaseRequest", { result }, "id=$1", [record.id]);
      await audit(
        this.db,
        p.owner,
        "case_request.fulfilled",
        record.id,
        "automatic",
        { policy_id: p.id, item_count: outcomes.length },
      );
      return { ...record, result };
    });
  }
  async requestResult(record: Row, owner: Row, agent = false) {
    const result = { ...record.result, files: [] as Row[] };
    for (const outcome of result.outcomes || []) {
      if (!outcome.transfer_id) continue;
      const t = await loadTransfer(this.db, outcome.transfer_id);
      try {
        const item = await canDownload(this.db, owner, t);
        const path = `/api/${agent ? "agents/" : ""}v1/received/${item.id}/download/`;
        result.files.push({
          ...fileCard(t.version),
          item_id: item.id,
          sha256: t.version.sha256,
          download_url: path,
          api_download_url: path,
        });
      } catch (e) {
        if (!(e instanceof PolicyError)) throw e;
      }
    }
    return result;
  }
  async issueAgent(owner: Row, data: Row) {
    const p = await loadPolicy(this.db, data.policy_id);
    await checkPolicy(this.db, p, owner);
    const raw =
      "fyde_agent_" +
      randomUUID().replaceAll("-", "") +
      randomUUID().replaceAll("-", "");
    const token = await this.db.insert("CustomerToken", {
      owner_id: owner.id,
      kind: "agent",
      name: String(data.name || "Case agent").slice(0, 80),
      policy_id: p.id,
      policy_revision: p.revision,
      data_mode: owner.data_mode,
      token_hash: hash(raw),
      expires_at: new Date(Math.min(+later(30 * 86400), +p.expires_at)),
    });
    await audit(
      this.db,
      owner,
      "customer_credential.issued",
      token.id,
      "agent",
    );
    return {
      token: raw,
      id: token.id,
      expires_at: token.expires_at.toISOString(),
      scope:
        "One case permission: requests and received downloads only. No owned files or authority controls.",
    };
  }
}
