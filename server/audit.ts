import { randomUUID } from "node:crypto";
import type { SQL } from "./db";
import { digest } from "./security";
export async function audit(
  db: SQL,
  actor: any,
  action: string,
  resource: string,
  correlation: string = randomUUID(),
  reason: string | null = null,
  result = "success",
) {
  // Serialize the chain across PostgreSQL workers. PGlite serializes whole transactions.
  await db.query("LOCK TABLE audit IN EXCLUSIVE MODE");
  const last =
    (await db.query("SELECT hash FROM audit ORDER BY id DESC LIMIT 1")).rows[0]
      ?.hash || "GENESIS";
  const payload = [
    actor?.id || null,
    actor?.role_id || null,
    actor?.unitId || null,
    action,
    resource,
    result,
    reason,
    correlation,
  ];
  await db.query(
    "INSERT INTO audit(user_id,role_id,unit_id,action,resource,result,reason,correlation_id,previous_hash,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [...payload, last, digest(last + JSON.stringify(payload))],
  );
}
