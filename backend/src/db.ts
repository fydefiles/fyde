import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import pg from "pg";
import schema from "./schema.json" with { type: "json" };

pg.types.setTypeParser(20, (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error("Database integer exceeds the supported range.");
  return number;
});

// Values come from the existing migrations. Runtime inserts supply Django's application defaults.
export type Row = Record<string, any>;
export type Model = keyof typeof schema;
type Fields = Record<string, { default: unknown; json: boolean }>;
export class Database {
  readonly pool: pg.Pool;
  private context = new AsyncLocalStorage<pg.PoolClient>();
  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 4,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      application_name: "fyde-typescript",
    });
    this.pool.on("error", () =>
      console.error("Database connection became unavailable."),
    );
  }
  async query<T extends Row = Row>(
    text: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return (await (this.context.getStore() || this.pool).query(text, values))
      .rows as T[];
  }
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    const active = this.context.getStore();
    if (active) {
      const name = "sp_" + randomUUID().replaceAll("-", "");
      await active.query(`SAVEPOINT ${name}`);
      try {
        const result = await fn();
        await active.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (e) {
        await active.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw e;
      }
    }
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      const value = await this.context.run(connection, fn);
      await connection.query("COMMIT");
      return value;
    } catch (e) {
      await connection.query("ROLLBACK");
      throw e;
    } finally {
      connection.release();
    }
  }
  async rows(
    model: Model,
    where = "TRUE",
    values: unknown[] = [],
    suffix = "",
  ): Promise<Row[]> {
    return this.query(
      `SELECT * FROM ${schema[model].table} WHERE ${where} ${suffix}`,
      values,
    );
  }
  async one(
    model: Model,
    where = "TRUE",
    values: unknown[] = [],
    suffix = "",
  ): Promise<Row | undefined> {
    const locked = suffix.startsWith("FOR ");
    return (
      await this.rows(
        model,
        where,
        values,
        locked ? `LIMIT 1 ${suffix}` : `${suffix} LIMIT 1`,
      )
    )[0];
  }
  async insert(model: Model, values: Row): Promise<Row> {
    const fields = schema[model].fields as Fields;
    const data: Row = {};
    for (const [name, spec] of Object.entries(fields)) {
      const value = Object.hasOwn(values, name)
        ? values[name]
        : spec.default === "$uuid"
          ? randomUUID()
          : spec.default === "$now"
            ? new Date()
            : structuredClone(spec.default);
      data[name] = spec.json ? JSON.stringify(value) : value;
    }
    for (const name of Object.keys(values))
      if (!Object.hasOwn(fields, name)) {
        if (name !== "id" || model !== "User")
          throw new Error("Unknown model field.");
        data[name] = values[name];
      }
    const names = Object.keys(data);
    return (
      await this.query(
        `INSERT INTO ${schema[model].table} (${names.join(",")}) VALUES (${names.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
        Object.values(data),
      )
    )[0];
  }
  async update(
    model: Model,
    values: Row,
    where: string,
    args: unknown[],
  ): Promise<Row[]> {
    const fields = schema[model].fields as Fields;
    const names = Object.keys(values);
    if (!names.length) return [];
    for (const name of names)
      if (!Object.hasOwn(fields, name)) throw new Error("Unknown model field.");
    const offset = names.length;
    return this.query(
      `UPDATE ${schema[model].table} SET ${names.map((name, i) => `${name}=$${i + 1}`).join(",")} WHERE ${where.replace(/\$(\d+)/g, (_, n) => "$" + (Number(n) + offset))} RETURNING *`,
      [
        ...names.map((name) =>
          fields[name].json ? JSON.stringify(values[name]) : values[name],
        ),
        ...args,
      ],
    );
  }
}
