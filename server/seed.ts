import { randomUUID } from "node:crypto";
import { Database } from "./db";
import { hashPassword } from "./security";
import { audit } from "./audit";
export const roleDefinitions: Record<
  string,
  { name: string; permissions: string[] }
> = {
  ti: {
    name: "Administração técnica",
    permissions: [
      "structure.read",
      "structure.write",
      "users.read",
      "users.write",
      "settings.write",
      "audit.read",
      "overview.read",
      "backups.manage",
    ],
  },
  gestao: {
    name: "Gestão hospitalar",
    permissions: ["structure.read", "overview.read"],
  },
  recepcao: {
    name: "Recepção",
    permissions: [
      "structure.read",
      "patients.read",
      "patients.create",
      "patients.update",
      "overview.read",
    ],
  },
  medico: { name: "Médico", permissions: ["structure.read", "patients.read"] },
  enfermagem: {
    name: "Enfermagem",
    permissions: ["structure.read", "patients.read"],
  },
  farmacia: { name: "Farmácia", permissions: ["structure.read"] },
  laboratorio: { name: "Laboratório", permissions: ["structure.read"] },
  imagem: { name: "Imagem", permissions: ["structure.read"] },
  faturamento: { name: "Faturamento", permissions: ["structure.read"] },
  financeiro: { name: "Financeiro", permissions: ["structure.read"] },
  compras: { name: "Compras", permissions: ["structure.read"] },
  almoxarifado: { name: "Almoxarifado", permissions: ["structure.read"] },
  social: { name: "Serviço social", permissions: ["structure.read"] },
  auditoria: {
    name: "Auditoria",
    permissions: ["structure.read", "audit.read"],
  },
};
const phase2Permissions: Record<string, string[]> = {
  ti: ["schedules.read", "schedules.write", "beds.read", "beds.configure"],
  gestao: ["schedules.read", "beds.read"],
  recepcao: [
    "schedules.read",
    "appointments.read",
    "appointments.write",
    "encounters.read",
    "encounters.create",
    "encounters.route",
    "encounters.cancel",
    "beds.read",
    "beds.allocate",
  ],
  medico: [
    "schedules.read",
    "appointments.read",
    "encounters.read",
    "encounters.triage",
    "encounters.attend",
    "encounters.discharge",
    "beds.read",
    "beds.allocate",
    "beds.clean",
  ],
  enfermagem: [
    "schedules.read",
    "appointments.read",
    "encounters.read",
    "encounters.triage",
    "encounters.attend",
    "encounters.discharge",
    "beds.read",
    "beds.allocate",
    "beds.clean",
  ],
};
for (const [id, permissions] of Object.entries(phase2Permissions))
  roleDefinitions[id].permissions.push(...permissions);
for (const id of ["medico", "enfermagem"])
  roleDefinitions[id].permissions.push(
    "clinical.read",
    "clinical.join",
    "clinical.create",
    "clinical.update",
    "clinical.finalize",
    "clinical.rectify",
    "clinical.cancel",
  );
export async function seed(db: Database, password: string) {
  if (password.length < 14)
    throw new Error("DEMO_PASSWORD deve ter no mínimo 14 caracteres.");
  if ((await db.query("SELECT id FROM institutions LIMIT 1")).rows.length)
    throw new Error("Seed recusado: banco já contém instituição.");
  const hash = hashPassword(password);
  await db.transaction(async (q) => {
    const inst = randomUUID(),
      u1 = randomUUID(),
      u2 = randomUUID();
    await q.query("INSERT INTO institutions(id,name) VALUES($1,$2)", [
      inst,
      "Instituição Aurora — FICTÍCIA",
    ]);
    for (const [id, name] of [
      [u1, "Unidade Central · DEMO"],
      [u2, "Unidade Norte · DEMO"],
    ]) {
      await q.query(
        "INSERT INTO units(id,institution_id,name) VALUES($1,$2,$3)",
        [id, inst, name],
      );
      await q.query("INSERT INTO settings(unit_id) VALUES($1)", [id]);
      for (const name of ["Recepção", "Administração"])
        await q.query("INSERT INTO sectors(id,unit_id,name) VALUES($1,$2,$3)", [
          randomUUID(),
          id,
          name,
        ]);
    }
    for (const [id, r] of Object.entries(roleDefinitions)) {
      await q.query("INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3)", [
        id,
        r.name,
        r.permissions,
      ]);
      const uid = randomUUID();
      await q.query(
        "INSERT INTO users(id,email,name,password_hash,role_id) VALUES($1,$2,$3,$4,$5)",
        [uid, `${id}@demo.local`, `${r.name} · Demonstração`, hash, id],
      );
      for (const unit of id === "ti" ? [u1, u2] : [u1])
        await q.query("INSERT INTO user_units VALUES($1,$2)", [uid, unit]);
    }
    for (const [name, birth, provisional] of [
      ["Ana Exemplo", "1985-04-12", false],
      ["Ana Exemplo", "1992-09-20", false],
      ["Pessoa não identificada · DEMO", null, true],
      ["Bruno Fictício", "1970-01-15", false],
      ["Carla Demonstração", "2001-05-03", false],
    ])
      await q.query(
        "INSERT INTO patients(id,unit_id,name,birth_date,provisional) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), u1, name, birth, provisional],
      );
    await q.query(
      "INSERT INTO patients(id,unit_id,name,birth_date) VALUES($1,$2,$3,$4)",
      [randomUUID(), u2, "Paciente restrito à Norte · DEMO", "1990-01-01"],
    );
    await audit(q, null, "demo.seed", "foundation");
  });
}
if (require.main === module) {
  (async () => {
    if (process.env.APP_ENV !== "demonstracao")
      throw new Error("Seed permitido somente em demonstração.");
    if (!/^[A-Z2-7]{32,}$/.test(process.env.ADMIN_TOTP_SECRET || ""))
      throw new Error(
        "Configure ADMIN_TOTP_SECRET Base32 (32+ caracteres) no ambiente.",
      );
    const db = new Database();
    try {
      await db.migrate();
      await seed(db, process.env.DEMO_PASSWORD || "");
      console.log(
        "Dados fictícios criados. Senha fornecida pelo operador; TOTP obrigatório para ti@demo.local.",
      );
    } finally {
      await db.close();
    }
  })().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
