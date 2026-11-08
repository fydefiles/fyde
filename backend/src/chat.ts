import type { Database, Row } from "./db.js";
import { PolicyError, hash, later, normalize, requireValue } from "./core.js";
import {
  canonical,
  contactCard,
  documentTypes,
  fileCard,
  loadVersion,
} from "./policy.js";
import type { Sharing } from "./sharing.js";

export class Chat {
  constructor(
    readonly db: Database,
    readonly sharing: Sharing,
  ) {}
  async search(owner: Row, query: string) {
    const ignored = new Set([
      "find",
      "my",
      "latest",
      "the",
      "file",
      "files",
      "documents",
      "document",
      "a",
      "all",
      "for",
      "about",
      "regarding",
      "case",
    ]);
    const terms = (normalize(query).match(/[\p{L}\p{N}_\.\-]+/gu) || []).filter(
      (t) => !ignored.has(t),
    );
    const rows = await this.db.query(
      `SELECT v.id FROM exchange_fileversion v JOIN exchange_document d ON d.current_version_id=v.id WHERE d.owner_id=$1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC LIMIT 1000`,
      [owner.id],
    );
    const result = [];
    for (const row of rows) {
      const v = await loadVersion(this.db, row.id),
        label = normalize(
          `${v.document.title} ${v.original_name} ${v.document.tags} ${v.document.document_type} ${v.document.matter?.name || ""}`,
        ),
        body = normalize(v.extracted_text);
      if (terms.every((t) => label.includes(t) || body.includes(t)))
        result.push(v);
      if (result.length === 30) break;
    }
    return result;
  }
  async history(owner: Row) {
    return (
      await this.db.rows(
        "ChatExchange",
        "owner_id=$1",
        [owner.id],
        "ORDER BY created_at DESC LIMIT 100",
      )
    )
      .reverse()
      .map(serialize);
  }
  private async send(
    owner: Row,
    versions: Row[],
    contacts: Row[],
    operation: string,
    channel: string,
    result: Row,
  ) {
    if (
      contacts.length !== 1 ||
      !versions.length ||
      (versions.length > 1 && !result.allow_many)
    ) {
      Object.assign(result, {
        kind: "clarify",
        files: versions.slice(0, 20).map(fileCard),
        contacts: contacts.slice(0, 30).map(contactCard),
      });
      return "Choose the exact file and recipient. I’ll check permissions before sending.";
    }
    const batch = versions.slice(0, 10),
      outcomes: Row[] = [];
    for (const [i, v] of batch.entries())
      try {
        const t = await this.sharing.createTransfer(
          owner,
          v.id,
          contacts[0].id,
          `chat/${operation}/${i}`,
          channel,
        );
        outcomes.push({
          id: t.id,
          title: v.document.title,
          state: t.status,
          channel: t.channel,
          url: `/receipts?id=${t.id}`,
        });
      } catch (e) {
        if (!(e instanceof PolicyError)) throw e;
        outcomes.push({
          title: v.document.title,
          state: e.code,
          message: e.message,
        });
      }
    Object.assign(result, {
      kind: "sent",
      transfers: outcomes,
      context: { version_id: batch[0].id, contact_id: contacts[0].id },
      remaining_versions: versions.slice(10).map((v) => v.id),
    });
    const available = outcomes.filter(
        (o) => o.state === "available_in_app",
      ).length,
      queued = outcomes.filter((o) => o.state === "queued").length;
    const reply = [];
    if (available)
      reply.push(
        `${available} ${available === 1 ? "file is" : "files are"} available in ${contacts[0].name}’s Fyde inbox.`,
      );
    if (queued)
      reply.push(
        `${queued} download links are queued. The receipt records the delivery result.`,
      );
    if (versions.length > 10)
      reply.push(
        `${versions.length - 10} more files remain; send the next batch when ready.`,
      );
    return reply.length
      ? reply.join(" ")
      : "The file was not sent. " +
          [...new Set(outcomes.map((o) => o.message || o.state))].join(" ");
  }
  async converse(
    owner: Row,
    message: unknown,
    operation: string,
    channel?: string,
    choice?: Row,
  ) {
    if (typeof message !== "string" || !message.trim() || message.length > 2000)
      throw new PolicyError(
        "invalid_message",
        "Write a message of up to 2,000 characters.",
        400,
      );
    channel = channel || owner.default_delivery_channel;
    if (
      !["in_app", "email", "phone"].includes(channel!) ||
      (choice != null && (typeof choice !== "object" || Array.isArray(choice)))
    )
      throw new PolicyError(
        "invalid_message",
        "Choose a supported channel or file choice.",
        400,
      );
    return this.db.tx(async () => {
      await this.db.one("User", "id=$1", [owner.id], "FOR UPDATE");
      const fingerprint = hash(canonical([message, channel, choice ?? null])),
        prior = await this.db.one(
          "ChatExchange",
          "owner_id=$1 AND operation_id=$2",
          [owner.id, operation],
        );
      if (prior) {
        if (prior.input_hash !== fingerprint)
          throw new PolicyError(
            "idempotency_conflict",
            "This message operation was used for different content.",
            409,
          );
        return serialize(prior);
      }
      let recent = owner.chat_context_enabled
        ? await this.db.one(
            "ChatExchange",
            "owner_id=$1 AND created_at>$2 AND reply<>''",
            [owner.id, later(-900)],
            "ORDER BY created_at DESC",
          )
        : undefined;
      if (choice) {
        recent = await this.db.one(
          "ChatExchange",
          "owner_id=$1 AND id=$2 AND created_at>$3",
          [owner.id, choice.turn_id, later(-900)],
        );
        if (!recent)
          throw new PolicyError(
            "choice_expired",
            "That choice expired. Ask again to find the current files.",
          );
      }
      const context = recent?.result.context || {},
        result: Row = { kind: "message", channel };
      const turn = await this.db.insert("ChatExchange", {
        owner_id: owner.id,
        operation_id: operation,
        input_hash: fingerprint,
        message: message.trim(),
        reply: "",
      });
      let text = message.trim();
      for (let i = 0; i < 2; i++)
        text = text.replace(/^(?:(?:can|could|would) you\s+|please\s+)/i, "");
      let reply =
        "I can find a file, send it to a contact, or request documents under a case permission. Try ‘Find my passport’, ‘Send it to my lawyer’, or ‘Request passport for Immigration case’.";
      let action: string | undefined;
      if (
        /^(?:add|upload|import)\s+(?:(?:some|more|my|new)\s+)?(?:files?|documents?)\b/i.test(
          text,
        ) ||
        /^(?:create|add|manage|rename|edit|update)\s+(?:(?:a|my)\s+)?(?:cases?|projects?)[.!]?$/i.test(
          text,
        )
      )
        action = "files";
      else if (
        /^(?:add|manage|edit|update)\s+(?:(?:a|my|new)\s+)?(?:contacts?|people|relationships?)[.!]?$/i.test(
          text,
        )
      )
        action = "people";
      else if (
        /^(?:manage|review|change|edit|update|show)\s+(?:my\s+)?(?:permissions|sharing|automatic sharing|case permissions)[.!]?$/i.test(
          text,
        )
      )
        action = "permissions";
      else if (
        /^(?:change|edit|update|classify|organize)\s+(?:my\s+)?(?:file details|files|documents|document details)[.!]?$/i.test(
          text,
        )
      )
        action = "classify";
      const allContacts = await this.db.rows(
        "Contact",
        "owner_id=$1",
        [owner.id],
        "LIMIT 1000",
      );
      if (action) {
        Object.assign(result, {
          kind: "workspace_action",
          section: action,
          action_label:
            action === "people"
              ? "Manage contacts →"
              : action === "permissions"
                ? "Review sharing permissions →"
                : action === "classify"
                  ? "Change file details →"
                  : "Add files →",
        });
        reply =
          action === "people"
            ? "Add a contact and relationship here. A relationship label does not grant document access."
            : action === "permissions"
              ? "Review the case, verified recipient and document scope. Changes to automatic sharing require your explicit approval."
              : action === "classify"
                ? "Review each file’s case, type and sensitivity before saving."
                : "Choose files to import and the case they belong to. They remain private until your sharing rules allow a transfer.";
      } else if (
        /^(allow|let|authorize)\b/i.test(text) &&
        /request|automatic/i.test(text)
      ) {
        const contacts = allContacts.filter(
          (c) =>
            (c.relationship &&
              normalize(text).includes(normalize(c.relationship))) ||
            normalize(text).includes(normalize(c.name)),
        );
        const matters = (
          await this.db.rows("Matter", "owner_id=$1", [owner.id])
        ).filter(
          (m) =>
            normalize(text).includes(normalize(m.name)) ||
            normalize(text)
              .split(/\s+/)
              .includes(normalize(m.name).split(/\s+/)[0]),
        );
        Object.assign(result, {
          kind: "policy_draft",
          contact_id: contacts.length === 1 ? contacts[0].id : "",
          matter_id: matters.length === 1 ? matters[0].id : "",
        });
        reply =
          "Review the case, verified contact and document scope. After you enable the permission, matching requests are fulfilled automatically.";
      } else if (/^.+?\s+is\s+my\s+.+?[.!]?$/i.test(text)) {
        const [person, relationship] = text.split(/\s+is\s+my\s+/i),
          matches = allContacts.filter(
            (c) => normalize(c.name) === normalize(person),
          );
        if (matches.length === 1) {
          const c = matches[0],
            label = relationship.replace(/[ .!]+$/, "").slice(0, 80);
          await this.db.update("Contact", { relationship: label }, "id=$1", [
            c.id,
          ]);
          reply = `Saved ${c.name} as your ${label}. Their document access still follows the permissions you enable.`;
        } else
          reply =
            "Say ‘Add a contact’ to add that person, or use their exact contact name.";
      } else if (/^(request|get|ask for)\b/i.test(text) || choice?.policy_id) {
        let policies = await this.sharing.peerPolicies(owner);
        if (choice?.policy_id) {
          if (
            !(recent!.result.policies || []).some(
              (p: Row) => p.id === choice.policy_id,
            )
          )
            throw new PolicyError(
              "invalid_choice",
              "Choose one of the offered case permissions.",
            );
          policies = policies.filter((p) => p.id === choice.policy_id);
        } else {
          const specific = policies.filter(
            (p) =>
              normalize(text).includes(normalize(p.matter.name)) ||
              normalize(text)
                .split(/\s+/)
                .includes(normalize(p.matter.name).split(/\s+/)[0]) ||
              (p.owner.first_name &&
                normalize(text).includes(normalize(p.owner.first_name))),
          );
          if (specific.length) policies = specific;
        }
        if (policies.length !== 1) {
          Object.assign(result, {
            kind: "choose_policy",
            policies: policies.map((p) => ({
              id: p.id,
              name: p.matter.name,
              from: p.owner.first_name || "File owner",
            })),
          });
          reply = policies.length
            ? "Choose the case permission to use."
            : "No active case permission is available for your verified account. The file owner can manage permissions to enable one.";
        } else {
          const p = policies[0],
            requestText = choice?.policy_id ? recent!.message : text;
          const subject = requestText
              .replace(/^(request|get|ask for)\s+/i, "")
              .split(/\s+(?:from|for|regarding|about)\s+/i)[0],
            words = normalize(subject)
              .replace(/[ .!?]+$/, "")
              .split(/\s+/);
          const known = documentTypes
              .map(([k]) => k)
              .filter((k) => k !== "general" && words.includes(k)),
            ignored = new Set([
              "my",
              "the",
              "a",
              "an",
              "all",
              "any",
              "document",
              "documents",
              "file",
              "files",
              "please",
              ...normalize(p.matter.name).split(/\s+/),
              ...known,
            ]);
          const record = await this.sharing.fulfill(
            owner,
            p.id,
            `chat-request/${operation}`,
            {
              types: known.length ? known : ["*"],
              query: words.filter((w: string) => !ignored.has(w)).join(" "),
            },
          );
          const fulfilled = await this.sharing.requestResult(record, owner);
          Object.assign(result, {
            kind: "received",
            files: fulfilled.files,
            outcomes: fulfilled.outcomes,
            next_cursor: fulfilled.next_cursor,
            policy_id: p.id,
          });
          reply = fulfilled.files.length
            ? `${fulfilled.files.length} files received under ${p.matter.name}. The owner's standing permission handled the request automatically.`
            : fulfilled.message;
        }
      } else if (
        choice ||
        (recent?.result.kind === "clarify" &&
          !/^(find|send|share|email)\b/i.test(text))
      ) {
        const offered = recent!.result;
        result.allow_many = !!offered.allow_many || !!choice?.remaining;
        let ids: string[] = choice?.remaining
          ? offered.remaining_versions || []
          : (offered.files || []).map((v: Row) => v.id);
        let contacts = allContacts.filter((c) =>
          choice?.remaining
            ? c.id === offered.context?.contact_id
            : (offered.contacts || []).some((v: Row) => v.id === c.id),
        );
        if (choice?.version_id)
          ids = ids.filter((id) => id === choice.version_id);
        if (choice?.contact_id)
          contacts = contacts.filter((c) => c.id === choice.contact_id);
        let versions: Row[] = [];
        for (const id of ids) {
          const v = await loadVersion(this.db, id);
          if (v.document.owner_id === owner.id && !v.document.deleted_at)
            versions.push(v);
        }
        if (!choice) {
          const cs = contacts.filter((c) =>
            [c.name, c.relationship, c.email]
              .map(normalize)
              .includes(normalize(text)),
          );
          if (cs.length) contacts = cs;
          const vs = versions.filter((v) =>
            normalize(`${v.document.title} ${v.original_name}`).includes(
              normalize(text),
            ),
          );
          if (vs.length) versions = vs;
        }
        if (versions.length > 1 && !choice && !/\ball\b/i.test(text)) {
          Object.assign(result, {
            kind: "clarify",
            files: versions.map(fileCard),
            contacts: contacts.map(contactCard),
          });
          reply = "Which exact file did you mean?";
        } else
          reply = await this.send(
            owner,
            versions,
            contacts,
            operation,
            offered.channel || channel!,
            result,
          );
      } else {
        const suffix = text.match(
          /\s+(?:by|via|in)\s+(fyde|(?:the\s+)?app|email|phone|sms)[.!]?$/i,
        );
        if (suffix) {
          const label = suffix[1].toLowerCase();
          channel =
            label === "email"
              ? "email"
              : ["phone", "sms"].includes(label)
                ? "phone"
                : "in_app";
          text = text.slice(0, suffix.index);
        }
        const command = text.match(
          /^(send|share|email)\s+(.+?)\s+(?:to|with)\s+(.+?)[.!]?$/i,
        );
        if (!command) {
          const versions = await this.search(owner, text);
          Object.assign(result, {
            kind: "search",
            files: versions.map(fileCard),
          });
          if (versions.length === 1)
            result.context = { ...context, version_id: versions[0].id };
          reply = versions.length
            ? `Found ${versions.length} matching ${versions.length === 1 ? "file" : "files"} in your workspace.`
            : "I couldn’t find a matching file in your workspace. Try its name, document type or case.";
        } else {
          const [, verb, fileText, recipientText] = command;
          const query = normalize(
            recipientText.replace(/^(?:my|the)\s+/i, "").replace(/[ .!]+$/, ""),
          );
          const fileQuery = fileText.replace(/^(?:my|the)\s+/i, "");
          let versions: Row[] = [];
          if (["it", "this", "that"].includes(normalize(fileQuery))) {
            if (context.version_id) {
              const v = await loadVersion(this.db, context.version_id);
              if (v.document.owner_id === owner.id && !v.document.deleted_at)
                versions = [v];
            }
          } else versions = await this.search(owner, fileQuery);
          const contacts = allContacts.filter((c) =>
            ["him", "her", "them"].includes(query)
              ? c.id === context.contact_id
              : [
                  c.name,
                  c.relationship,
                  c.email,
                  c.phone,
                  ...c.aliases.split(","),
                ].some((x) => normalize(x) === query) ||
                normalize(c.name).split(/\s+/).includes(query) ||
                normalize(c.relationship).split(/\s+/).includes(query),
          );
          channel = verb.toLowerCase() === "email" ? "email" : channel;
          result.channel = channel;
          result.allow_many = /\b(all|documents|files)\b/i.test(text);
          if (versions.length > 1 && !result.allow_many) {
            Object.assign(result, {
              kind: "clarify",
              files: versions.map(fileCard),
              contacts: (contacts.length
                ? contacts
                : allContacts.slice(0, 30)
              ).map(contactCard),
            });
            reply =
              "I found more than one match. Choose the exact file and contact.";
          } else
            reply = await this.send(
              owner,
              versions,
              contacts,
              operation,
              channel!,
              result,
            );
        }
      }
      const [updated] = await this.db.update(
        "ChatExchange",
        { reply, result },
        "id=$1",
        [turn.id],
      );
      return serialize(updated);
    });
  }
}
export function serialize(turn: Row) {
  return {
    id: turn.id,
    message: turn.message,
    reply: turn.reply,
    result: turn.result,
    created_at: turn.created_at.toISOString(),
  };
}
