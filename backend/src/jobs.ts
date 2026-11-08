import { config } from "./config.js";
import { Database } from "./db.js";
import { same } from "./core.js";
import { Files, NeonObjects } from "./storage.js";
let worker: { db: Database; files: Files; key: string };
export default {
  async fetch(request: Request) {
    if (!worker) {
      const cfg = config(),
        db = new Database(cfg.databaseUrl);
      worker = {
        db,
        files: new Files(db, new NeonObjects(cfg), cfg),
        key: cfg.jobKey,
      };
    }
    // Neon strips client-supplied X-Neon-* headers before injecting its trigger attestation.
    const triggered = !!request.headers.get("X-Neon-Trigger-Invocation-Id");
    if (
      request.method !== "POST" ||
      (!triggered &&
        !same(
          request.headers.get("Authorization") || "",
          "Bearer " + worker.key,
        ))
    )
      return new Response("Unavailable", { status: 403 });
    try {
      const result = await worker.files.process(5);
      await worker.db.query(
        "DELETE FROM exchange_neonoauthattempt WHERE expires_at<now()-interval '1 day'",
      );
      return Response.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch {
      return Response.json({ error: "worker_unavailable" }, { status: 503 });
    }
  },
};
