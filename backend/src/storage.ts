import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import type { Config } from "./config.js";
import type { Database, Row } from "./db.js";
import { PolicyError, audit, hash, requireValue } from "./core.js";
import { documentTypes, entitlement, loadVersion } from "./policy.js";
import { Sharing } from "./sharing.js";

export interface ObjectStore {
  put(
    key: string,
    body: Uint8Array,
    mime: string,
    digest: string,
  ): Promise<void>;
  get(version: Row): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
export class NeonObjects implements ObjectStore {
  private s3: S3Client;
  constructor(private config: Config) {
    this.s3 = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.s3Key,
        secretAccessKey: config.s3Secret,
      },
      maxAttempts: 3,
    });
  }
  async put(key: string, body: Uint8Array, mime: string, digest: string) {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentLength: body.length,
          ContentType: mime,
          CacheControl: "private, no-store",
          Metadata: { sha256: digest },
        }),
      );
    } catch {
      throw new PolicyError(
        "storage_unavailable",
        "Private storage is unavailable. Retry the upload.",
        503,
      );
    }
  }
  async get(version: Row) {
    try {
      const result = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: version.blob_key,
        }),
      );
      if (result.ContentLength !== Number(version.size) || !result.Body) {
        if (result.Body && "destroy" in result.Body) result.Body.destroy();
        throw new PolicyError(
          "hash_mismatch",
          "Stored content failed its integrity check.",
        );
      }
      const parts: Uint8Array[] = [];
      let size = 0;
      for await (const part of result.Body as AsyncIterable<Uint8Array>) {
        size += part.length;
        if (size > Number(version.size))
          throw new PolicyError(
            "hash_mismatch",
            "Stored content failed its integrity check.",
          );
        parts.push(part);
      }
      const body = Buffer.concat(parts);
      if (size !== Number(version.size) || hash(body) !== version.sha256)
        throw new PolicyError(
          "hash_mismatch",
          "Stored content failed its integrity check.",
        );
      return body;
    } catch (e) {
      if (e instanceof PolicyError) throw e;
      throw new PolicyError(
        "storage_unavailable",
        "The private file is unavailable. Try again shortly.",
        503,
      );
    }
  }
  async delete(key: string) {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
    } catch {
      throw new PolicyError(
        "storage_unavailable",
        "File removal is pending. Fyde will retry it.",
        503,
      );
    }
  }
}
const allowed: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export class Files {
  constructor(
    readonly db: Database,
    readonly objects: ObjectStore,
    readonly config: Config,
  ) {}
  async upload(owner: Row, file: File, data: Row) {
    const name = file.name
        .replaceAll("\\", "/")
        .split("/")
        .pop()!
        .slice(0, 180),
      ext = name.split(".").pop()!.toLowerCase(),
      mime = allowed[ext];
    if (!mime)
      throw new PolicyError(
        "unsupported_type",
        "Upload a TXT, Markdown, CSV, PDF, or DOCX file.",
      );
    const { plan } = await entitlement(this.db, owner);
    if (!file.size || file.size > plan.file_mib * 1024 * 1024)
      throw new PolicyError(
        "file_size_limit",
        `Files must be between 1 byte and ${plan.file_mib} MiB.`,
      );
    await this.validateClassification(owner, data);
    const bytes = new Uint8Array(await file.arrayBuffer()),
      digest = hash(bytes),
      key = `${owner.id}/${randomUUID().replaceAll("-", "")}`;
    await this.objects.put(key, bytes, mime, digest);
    try {
      return await this.db.tx(async () => {
        await this.db.one("User", "id=$1", [owner.id], "FOR UPDATE");
        const used = Number(
          (
            await this.db.query(
              "SELECT coalesce(sum(v.size),0) AS n FROM exchange_fileversion v JOIN exchange_document d ON d.id=v.document_id WHERE d.owner_id=$1 AND d.deleted_at IS NULL",
              [owner.id],
            )
          )[0].n,
        );
        if (used + bytes.length > plan.storage_mib * 1024 * 1024)
          throw new PolicyError(
            "storage_limit",
            "Your storage allowance is full. Export or delete files first.",
          );
        let document: Row;
        if (data.document_id)
          document = requireValue(
            await this.db.one(
              "Document",
              "id=$1 AND owner_id=$2 AND deleted_at IS NULL",
              [data.document_id, owner.id],
              "FOR UPDATE",
            ),
          );
        else
          document = await this.db.insert("Document", {
            owner_id: owner.id,
            title: String(data.title || name).slice(0, 180),
            tags: String(data.tags || "").slice(0, 250),
            sensitive: data.sensitive === true || data.sensitive === "true",
            matter_id: data.matter_id || null,
            document_type: data.document_type || "general",
          });
        const number = Number(
          (
            await this.db.query(
              "SELECT coalesce(max(number),0)+1 AS n FROM exchange_fileversion WHERE document_id=$1",
              [document.id],
            )
          )[0].n,
        );
        const version = await this.db.insert("FileVersion", {
          document_id: document.id,
          number,
          original_name: name,
          blob_key: key,
          sha256: digest,
          size: bytes.length,
          mime,
        });
        if (!document.current_version_id)
          [document] = await this.db.update(
            "Document",
            { current_version_id: version.id },
            "id=$1",
            [document.id],
          );
        await audit(this.db, owner, "file.uploaded", version.id, "quarantined");
        return loadVersion(this.db, version.id);
      });
    } catch (e) {
      try {
        await this.objects.delete(key);
      } catch {
        /* A cleanup record is retained below if remote removal fails. */
        // Preserve a durable deletion intent without exposing an orphan's bytes to the workspace.
        const d = await this.db.insert("Document", {
          owner_id: owner.id,
          title: "Incomplete upload",
          deleted_at: new Date(),
        });
        await this.db.insert("FileVersion", {
          document_id: d.id,
          number: 1,
          original_name: name,
          blob_key: key,
          sha256: digest,
          size: bytes.length,
          mime,
          state: "deleted",
          extraction_state: "deleted",
        });
      }
      throw e;
    }
  }
  async validateClassification(owner: Row, data: Row) {
    if (
      !documentTypes.some(([key]) => key === (data.document_type || "general"))
    )
      throw new PolicyError(
        "invalid_type",
        "Choose a supported document type.",
      );
    if (
      data.matter_id &&
      !(await this.db.one("Matter", "id=$1 AND owner_id=$2", [
        data.matter_id,
        owner.id,
      ]))
    )
      throw new PolicyError(
        "invalid_classification",
        "Choose one of your own cases.",
      );
  }
  async classify(owner: Row, id: string, data: Row) {
    await this.validateClassification(owner, data);
    const changed = await this.db.update(
      "Document",
      {
        matter_id: data.matter_id || null,
        document_type: data.document_type || "general",
        sensitive: data.sensitive === true,
      },
      "id=$1 AND owner_id=$2 AND deleted_at IS NULL",
      [id, owner.id],
    );
    requireValue(changed[0]);
    await audit(this.db, owner, "document.classified", id, "owner_assigned");
  }
  async remove(owner: Row, id: string) {
    await this.db.tx(async () => {
      await this.db.one("User", "id=$1", [owner.id], "FOR UPDATE");
      requireValue(
        await this.db.one(
          "Document",
          "id=$1 AND owner_id=$2 AND deleted_at IS NULL",
          [id, owner.id],
          "FOR UPDATE",
        ),
      );
      await this.db.update("Document", { deleted_at: new Date() }, "id=$1", [
        id,
      ]);
      await this.db.update(
        "FileVersion",
        { state: "deleted", extraction_state: "deleted", extracted_text: "" },
        "document_id=$1",
        [id],
      );
      await this.db.query(
        "UPDATE exchange_grant SET revoked_at=now(),revision=revision+1 WHERE version_id IN (SELECT id FROM exchange_fileversion WHERE document_id=$1) AND revoked_at IS NULL",
        [id],
      );
      const transfers = await this.db.query(
        "SELECT t.* FROM exchange_transfer t JOIN exchange_fileversion v ON v.id=t.version_id WHERE v.document_id=$1 FOR UPDATE OF t",
        [id],
      );
      // Avoid a storage provider outage undoing the immediate access revocation.
      for (const t of transfers) await new Sharing(this.db).revoke(owner, t.id);
      await audit(this.db, owner, "document.deleted", id, "deny");
    });
    return {
      deleted: true,
      message: "Access revoked. Private originals are queued for removal.",
    };
  }
  private async scan(bytes: Uint8Array) {
    if (!this.config.scannerHost)
      throw new PolicyError(
        "scanner_not_configured",
        "PDF and DOCX remain quarantined until a malware scanner is configured.",
      );
    await new Promise<void>((resolve, reject) => {
      const socket = connect({
        host: this.config.scannerHost,
        port: this.config.scannerPort,
      });
      let reply = "";
      socket.setTimeout(15000, () =>
        socket.destroy(new Error("Scanner timed out")),
      );
      socket.on("error", () =>
        reject(
          new PolicyError(
            "scan_failed",
            "The malware scanner did not approve this file.",
          ),
        ),
      );
      socket.on("data", (chunk) => {
        reply += chunk.toString();
        if (reply.length > 4096)
          socket.destroy(new Error("Invalid scanner response"));
      });
      socket.on("end", () =>
        reply.includes("stream: OK")
          ? resolve()
          : reject(
              new PolicyError(
                "scan_failed",
                "The malware scanner did not approve this file.",
              ),
            ),
      );
      socket.on("connect", () => {
        socket.write(Buffer.from("zINSTREAM\0"));
        for (let i = 0; i < bytes.length; i += 65536) {
          const chunk = bytes.subarray(i, i + 65536),
            length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
    });
  }
  async process(limit = 5) {
    let checked = 0,
      removed = 0;
    for (let i = 0; i < limit; i++)
      await this.db.tx(async () => {
        const v = await this.db.one(
          "FileVersion",
          "state='quarantined' AND extraction_state='pending'",
          [],
          "FOR UPDATE SKIP LOCKED",
        );
        if (!v) return;
        try {
          const bytes = await this.objects.get(v);
          if (!v.mime.startsWith("text/")) {
            await this.scan(bytes);
            // Keep the existing quarantine boundary until bounded PDF/DOCX extraction is configured.
            throw new PolicyError(
              "extraction_not_configured",
              "This document passed malware scanning but still needs a configured text extractor.",
            );
          }
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
            throw new PolicyError(
              "invalid_text",
              "Only inert UTF-8 text is accepted by text validation.",
            );
          if (this.config.scannerHost) await this.scan(bytes);
          await this.db.query(
            `UPDATE exchange_fileversion v SET state='ready',extraction_state='indexed',extracted_text=$2,check_detail='UTF-8 text validation'
          WHERE v.id=$1 AND v.state='quarantined' AND EXISTS (SELECT 1 FROM exchange_document d WHERE d.id=v.document_id AND d.deleted_at IS NULL)`,
            [v.id, text.slice(0, 250000)],
          );
          checked++;
        } catch (e) {
          if (e instanceof PolicyError && e.code === "storage_unavailable")
            return;
          await this.db.update(
            "FileVersion",
            {
              extraction_state: "blocked",
              check_detail:
                e instanceof PolicyError
                  ? e.message.slice(0, 250)
                  : "File checks failed; manual review required.",
            },
            "id=$1 AND state='quarantined'",
            [v.id],
          );
        }
      });
    for (let i = 0; i < limit; i++)
      await this.db.tx(async () => {
        const v = await this.db.one(
          "FileVersion",
          "state='deleted' AND blob_deleted_at IS NULL",
          [],
          "FOR UPDATE SKIP LOCKED",
        );
        if (!v) return;
        try {
          await this.objects.delete(v.blob_key);
        } catch {
          return;
        }
        await this.db.update(
          "FileVersion",
          { blob_deleted_at: new Date() },
          "id=$1 AND state='deleted'",
          [v.id],
        );
        removed++;
      });
    return { checked, removed };
  }
  async download(version: Row) {
    const bytes = await this.objects.get(version);
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${version.original_name.replace(/[^\w.()-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(version.original_name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
