import "dotenv/config";
import { Injectable } from "@nestjs/common";
import { Pool, types } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { audit } from "./audit";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { lockDatabase } from "./database-lock";
import { fingerprints } from "./snapshot";

export type SQL = {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
};
// SQL DATE represents a civil date, never an instant in the host timezone.
types.setTypeParser(1082, (value) => value);
@Injectable()
export class Database implements SQL {
  private pool?: Pool;
  private embedded?: PGlite;
  private queue: Promise<any> = Promise.resolve();
  private releaseLock?: () => void;
  private closing?: Promise<void>;
  constructor() {
    if (process.env.DB_MODE === "postgres") {
      if (!process.env.DATABASE_URL)
        throw new Error("DATABASE_URL obrigatória");
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
      });
    } else {
      const directory = process.env.PGLITE_PATH || "./data/demo";
      if (!directory.startsWith("memory://"))
        mkdirSync(path.dirname(path.resolve(directory)), { recursive: true });
      if (!directory.startsWith("memory://"))
        this.releaseLock = lockDatabase(directory);
      try {
        this.embedded = new PGlite(directory);
      } catch (e) {
        this.releaseLock?.();
        throw e;
      }
    }
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    if (this.pool) return this.pool.query(sql, params);
    return this.exclusive(() => this.embedded!.query(sql, params));
  }
  async transaction<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    return this.exclusive(() =>
      this.embedded!.transaction(async (tx) =>
        fn({ query: (q, p) => tx.query(q, p) }),
      ),
    );
  }
  async migrate() {
    const files = (await readdir(path.resolve("migrations")))
      .filter((v) => /^\d{3}_.+\.sql$/.test(v))
      .sort();
    const sources = await Promise.all(
      files.map(async (name) => ({
        version: Number(name.slice(0, 3)),
        sql: await readFile(path.resolve("migrations", name), "utf8"),
      })),
    );
    const run = async (q: SQL, exec: (sql: string) => Promise<unknown>) => {
      const exists = (
        await q.query("SELECT to_regclass('public.schema_migrations') AS name")
      ).rows[0].name;
      if (!exists) await exec(sources.find((s) => s.version === 1)!.sql);
      await q.query(
        "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text",
      );
      for (const source of sources) {
        const checksum = createHash("sha256")
          .update(source.sql.replace(/\r\n/g, "\n"))
          .digest("hex");
        const old = (
          await q.query(
            "SELECT checksum FROM schema_migrations WHERE version=$1",
            [source.version],
          )
        ).rows[0];
        if (old) {
          if (old.checksum && old.checksum !== checksum)
            throw new Error(
              `Checksum divergente na migração ${source.version}`,
            );
          if (!old.checksum)
            await q.query(
              "UPDATE schema_migrations SET checksum=$1 WHERE version=$2",
              [checksum, source.version],
            );
          continue;
        }
        await exec(source.sql);
        await q.query(
          "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
          [source.version, checksum],
        );
        await audit(
          q,
          null,
          "schema.migrate",
          `migration:${source.version}`,
          undefined,
          "Migração aditiva e atualização versionada de permissões",
        );
      }
    };
    if (this.pool) {
      const c = await this.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT pg_advisory_xact_lock(87001002)");
        await run(c, (sql) => c.query(sql));
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    } else
      await this.exclusive(() =>
        this.embedded!.transaction((tx) =>
          run({ query: (s, p) => tx.query(s, p) }, (sql) => tx.exec(sql)),
        ),
      );
  }
  close() {
    return (this.closing ||= (async () => {
      await this.queue;
      if (this.pool) await this.pool.end();
      else await this.embedded!.close();
      this.releaseLock?.();
    })());
  }
  async logicalDump() {
    if (!this.embedded)
      throw new Error(
        "Backup PostgreSQL servidor exige pg_dump configurado pela operação.",
      );
    return this.exclusive(async () => {
      const { pgDump } = await import("@electric-sql/pglite-tools");
      const searchPath = (
        await this.embedded!.query<{ search_path: string }>("SHOW search_path")
      ).rows[0].search_path;
      let sql: string;
      try {
        sql = await (await pgDump({ pg: this.embedded! })).text();
      } finally {
        // pg_dump uses a read-only transaction through the raw protocol. End
        // that transaction before restoring session settings for normal writes.
        await this.embedded!.exec("ROLLBACK");
        await this.embedded!.query(
          "SELECT set_config('search_path',$1,false)",
          [searchPath],
        );
      }
      return { sql, tables: await fingerprints(this.embedded!) };
    });
  }
}
