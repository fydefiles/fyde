import { readFile } from "node:fs/promises";
import { Database } from "./db.js";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url)
  throw new Error(
    "Supply MIGRATION_DATABASE_URL using the migration owner's private environment.",
  );
const db = new Database(url);
try {
  await db.tx(async () => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('fyde/typescript/schema',0))",
    );
    const exists = (
      await db.query("SELECT to_regclass('public.exchange_user') AS name")
    )[0].name;
    if (!exists)
      await db.query(
        await readFile(
          new URL("../migrations/0001_customer_baseline.sql", import.meta.url),
          "utf8",
        ),
      );
    const ready = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='exchange_user' AND column_name='neon_subject'",
    );
    if (
      !ready.length ||
      !(
        await db.query(
          "SELECT to_regclass('public.exchange_neonsession') AS name",
        )
      )[0].name
    )
      throw new Error(
        "Existing database needs the original identity/storage migration before this runtime can use it.",
      );
    await db.query(
      "CREATE TABLE IF NOT EXISTS public.fyde_schema_version (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    await db.query(
      "INSERT INTO public.fyde_schema_version (version) VALUES ('0001_customer_baseline') ON CONFLICT DO NOTHING",
    );
  });
  console.log(
    "Customer schema is ready. Existing identities and records were preserved.",
  );
} finally {
  await db.pool.end();
}
