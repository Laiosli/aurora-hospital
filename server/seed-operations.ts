import { randomUUID } from "node:crypto";
import { Database } from "./db";
import { audit } from "./audit";
async function main() {
  if (process.env.APP_ENV !== "demonstracao")
    throw new Error("Somente demonstração.");
  const db = new Database();
  try {
    await db.migrate();
    await db.transaction(async (q) => {
      const unit = (
        await q.query(
          "SELECT id FROM units WHERE name='Unidade Central · DEMO'",
        )
      ).rows[0];
      if (!unit) throw new Error("Instale o seed básico primeiro.");
      const admin = (
          await q.query(
            "SELECT id,role_id FROM users WHERE email='ti@demo.local'",
          )
        ).rows[0],
        professional = (
          await q.query("SELECT id FROM users WHERE email='medico@demo.local'")
        ).rows[0];
      if (!admin || !professional)
        throw new Error("Contas demonstrativas não encontradas.");
      const sectorName = "Internação · DEMO";
      await q.query(
        "INSERT INTO sectors(id,unit_id,name) VALUES($1,$2,$3) ON CONFLICT(unit_id,name) DO NOTHING",
        [randomUUID(), unit.id, sectorName],
      );
      const sector = (
        await q.query("SELECT id FROM sectors WHERE unit_id=$1 AND name=$2", [
          unit.id,
          sectorName,
        ])
      ).rows[0];
      await q.query(
        "INSERT INTO rooms(id,unit_id,sector_id,name) VALUES($1,$2,$3,$4) ON CONFLICT(unit_id,name) DO NOTHING",
        [randomUUID(), unit.id, sector.id, "Consultório 01 · DEMO"],
      );
      const room = (
        await q.query(
          "SELECT id FROM rooms WHERE unit_id=$1 AND name='Consultório 01 · DEMO'",
          [unit.id],
        )
      ).rows[0];
      for (const code of ["DEMO-101", "DEMO-102", "DEMO-103"])
        await q.query(
          "INSERT INTO beds(id,unit_id,sector_id,code) VALUES($1,$2,$3,$4) ON CONFLICT(unit_id,code) DO NOTHING",
          [randomUUID(), unit.id, sector.id, code],
        );
      if (
        !(
          await q.query("SELECT id FROM schedules WHERE unit_id=$1 LIMIT 1", [
            unit.id,
          ])
        ).rows.length
      ) {
        const start = new Date(Date.now() + 86400000);
        start.setUTCHours(12, 0, 0, 0);
        const end = new Date(+start + 8 * 3600000);
        await q.query(
          "INSERT INTO schedules(id,unit_id,room_id,professional_id,name,specialty,slot_minutes,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,30,$7,$8)",
          [
            randomUUID(),
            unit.id,
            room.id,
            professional.id,
            "Agenda de demonstração",
            "Clínica demonstrativa",
            start.toISOString(),
            end.toISOString(),
          ],
        );
      }
      const cfg = (
        await q.query("SELECT services FROM settings WHERE unit_id=$1", [
          unit.id,
        ])
      ).rows[0];
      const services = [
        ...new Set([...cfg.services, "ambulatorio", "internacao"]),
      ];
      await q.query(
        "UPDATE settings SET services=$1,version=version+1 WHERE unit_id=$2",
        [services, unit.id],
      );
      await audit(
        q,
        { ...admin, unitId: unit.id },
        "demo.operations_seed",
        "operations",
        randomUUID(),
        "Recursos fictícios e serviços de demonstração habilitados",
      );
    });
    console.log(
      "Recursos demonstrativos adicionados. Cadastros e credenciais anteriores preservados.",
    );
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
