import { createHash } from "node:crypto";
import type { SQL } from "./db";
function stable(v: any): any {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, stable(v[k])]),
    );
  return v;
}
export async function fingerprints(q: SQL) {
  const tables = (
    await q.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows;
  const result: Record<string, { rows: number; sha256: string }> = {};
  for (const { tablename } of tables) {
    if (!/^[a-z_][a-z_0-9]*$/.test(tablename))
      throw new Error("Nome de tabela não suportado no backup.");
    const rows = (
      await q.query(
        `SELECT to_jsonb(t) AS row FROM public."${tablename}" t ORDER BY to_jsonb(t)::text`,
      )
    ).rows.map((r) => stable(r.row));
    result[tablename] = {
      rows: rows.length,
      sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  return result;
}
