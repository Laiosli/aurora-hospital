import "reflect-metadata";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "../server/app";
import { Database } from "../server/db";
import { seed } from "../server/seed";
import { totp, digest } from "../server/security";

const password = "Apenas-Teste-2026-seguro";
process.env.APP_ENV = "demonstracao";
process.env.DB_MODE = "pglite";
process.env.PGLITE_PATH = "memory://";
process.env.APP_ORIGIN = "http://127.0.0.1:3000";
process.env.ADMIN_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
let app: any,
  db: Database,
  front: any,
  admin: any,
  nurse: any,
  units: any[],
  patient: any,
  loginOtp: string;
const origin = (r: any) =>
  r.set("Origin", "http://127.0.0.1:3000").set("X-Requested-With", "Aurora");
const mutate = (
  agent: any,
  url: string,
  body: any,
  method = "post",
  key = randomUUID(),
) =>
  origin(agent[method]("/api" + url))
    .set("Idempotency-Key", key)
    .send(body);
const base = (name = "Pessoa Fictícia Teste") => ({
  name,
  social_name: "",
  birth_date: "2000-01-01",
  provisional: false,
  cpf: null,
  cns: null,
  phone: "",
  mother_name: "",
  emergency_contact: "",
  accessibility: "",
});
before(async () => {
  app = await createApp();
  db = app.get(Database);
  await db.migrate();
  await seed(db, password);
  front = request.agent(app.getHttpServer());
  admin = request.agent(app.getHttpServer());
  nurse = request.agent(app.getHttpServer());
  await origin(front.post("/api/auth/login"))
    .send({ email: "recepcao@demo.local", password })
    .expect(201);
  await origin(admin.post("/api/auth/login"))
    .send({
      email: "ti@demo.local",
      password,
      otp: (loginOtp = totp(process.env.ADMIN_TOTP_SECRET!)),
    })
    .expect(201);
  await origin(nurse.post("/api/auth/login"))
    .send({ email: "enfermagem@demo.local", password })
    .expect(201);
  units = (await admin.get("/api/units")).body;
});
after(async () => {
  await app?.close();
  await db?.close();
});

test("Acesso anônimo recusado, health e contrato OpenAPI disponíveis", async () => {
  await request(app.getHttpServer()).get("/api/patients").expect(401);
  const h = await request(app.getHttpServer()).get("/api/health").expect(200);
  assert.equal(h.body.productionReady, false);
  const o = await request(app.getHttpServer())
    .get("/api/openapi.json")
    .expect(200);
  assert(o.body.paths["/api/patients"]);
});
test("Administração técnica não acessa pacientes, enfermagem não cria cadastros", async () => {
  await admin.get("/api/patients").expect(403);
  await mutate(nurse, "/patients", base()).expect(403);
});
test("Unidade e acesso direto a registro são limitados pelo vínculo", async () => {
  const foreign = (
    await db.query(
      "SELECT * FROM patients WHERE name LIKE 'Paciente restrito%'",
    )
  ).rows[0];
  await front.get("/api/patients/" + foreign.id).expect(404);
  await front
    .get("/api/patients")
    .set("X-Unit-Id", foreign.unit_id)
    .expect(403);
});
test("Cadastro provisório sem documento funciona e persiste", async () => {
  const r = await mutate(front, "/patients", {
    ...base("Pessoa provisória fictícia"),
    birth_date: null,
    provisional: true,
  }).expect(201);
  patient = r.body;
  const persisted = await front.get("/api/patients/" + patient.id).expect(200);
  assert.equal(persisted.body.provisional, true);
  assert.equal(persisted.body.cpf, null);
});
test("Reenvio concorrente não duplica paciente nem evento", async () => {
  const key = randomUUID(),
    body = base("Reenvio fictício");
  const [a, b] = await Promise.all([
    mutate(front, "/patients", body, "post", key),
    mutate(front, "/patients", body, "post", key),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.body.id, b.body.id);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM audit WHERE action='patients.create' AND resource=$1",
        [a.body.id],
      )
    ).rows[0].n,
    1,
  );
  await mutate(front, "/patients", base("Outro corpo"), "post", key).expect(
    409,
  );
});
test("CPF repetido é rejeitado e CPF inválido não é aceito", async () => {
  await mutate(front, "/patients", {
    ...base("CPF fictício"),
    cpf: "529.982.247-25",
  }).expect(201);
  await mutate(front, "/patients", {
    ...base("Duplicado fictício"),
    cpf: "52998224725",
  }).expect(409);
  await mutate(front, "/patients", { ...base(), cpf: "11111111111" }).expect(
    400,
  );
});
test("Homônimos têm aviso e busca/paginação são do servidor", async () => {
  const r = await front
    .get("/api/patients?q=Ana%20Exemplo&size=1&page=1&direction=desc")
    .expect(200);
  assert.equal(r.body.total, 2);
  assert.equal(r.body.rows.length, 1);
  assert.equal(r.body.rows[0].homonym, true);
  const p2 = await front.get(
    "/api/patients?q=Ana%20Exemplo&size=1&page=2&direction=desc",
  );
  assert.notEqual(r.body.rows[0].id, p2.body.rows[0].id);
});
test("Validação bloqueia campos extras, datas impossíveis/futuras e ordenação injetada", async () => {
  await mutate(front, "/patients", { ...base(), unit_id: units[1].id }).expect(
    400,
  );
  await mutate(front, "/patients", {
    ...base(),
    birth_date: "2026-02-30",
  }).expect(400);
  await mutate(front, "/patients", {
    ...base(),
    birth_date: "2099-01-01",
  }).expect(400);
  await front
    .get("/api/patients?sort=name%3BDROP%20TABLE%20patients")
    .expect(400);
});
test("Edição concorrente exige versão atual e justificativa", async () => {
  const body = {
    ...base("Pessoa reconciliada fictícia"),
    version: patient.version,
    reason: "Conferência da identificação",
  };
  const a = await mutate(
    front,
    "/patients/" + patient.id,
    body,
    "patch",
  ).expect(200);
  assert.equal(a.body.version, 2);
  await mutate(front, "/patients/" + patient.id, body, "patch").expect(409);
  await mutate(
    front,
    "/patients/" + patient.id,
    { ...body, version: 2, reason: "" },
    "patch",
  ).expect(400);
});
test("Falha da auditoria causa rollback do cadastro e da idempotência", async () => {
  await db.query(
    "CREATE FUNCTION fail_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='patients.create' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$",
  );
  await db.query(
    "CREATE TRIGGER fail_test BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fail_test_audit()",
  );
  try {
    const r = await mutate(
      front,
      "/patients",
      base("Não deve persistir"),
    ).expect(500);
    assert(r.body.correlationId);
    assert(!JSON.stringify(r.body).includes("test failure"));
    assert.equal(
      (
        await db.query(
          "SELECT count(*) AS n FROM patients WHERE name='Não deve persistir'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.query("DROP TRIGGER fail_test ON audit");
    await db.query("DROP FUNCTION fail_test_audit()");
  }
});
test("Origem externa e ausência de anti-CSRF não permitem escrita", async () => {
  await front.post("/api/patients").send(base()).expect(403);
  await front
    .post("/api/patients")
    .set("Origin", "https://externo.invalid")
    .set("X-Requested-With", "Aurora")
    .send(base())
    .expect(403);
});
test("Estrutura e configuração são persistidas e versionadas", async () => {
  const s = await mutate(admin, "/sectors", {
    name: "Setor fictício de teste",
  }).expect(201);
  assert(
    (await admin.get("/api/sectors")).body.some((v: any) => v.id === s.body.id),
  );
  const cfg = (await admin.get("/api/settings")).body;
  await mutate(
    admin,
    "/settings",
    {
      services: ["recepcao", "laboratorio"],
      version: cfg.version,
      reason: "Configuração de demonstração",
    },
    "patch",
  ).expect(200);
  await mutate(
    admin,
    "/settings",
    {
      services: [],
      version: cfg.version,
      reason: "Configuração desatualizada",
    },
    "patch",
  ).expect(409);
  await mutate(
    front,
    "/settings",
    { services: [], version: 2, reason: "Sem permissão" },
    "patch",
  ).expect(403);
});
test("Criação de unidade concede vínculo ao autor; fuso inválido é recusado", async () => {
  await mutate(admin, "/units", {
    name: "Unidade de Teste",
    timezone: "America/Sao_Paulo",
  }).expect(201);
  assert.equal((await admin.get("/api/units")).body.length, 3);
  await mutate(admin, "/units", {
    name: "Fuso inválido",
    timezone: "Marte/Centro",
  }).expect(400);
});
test("Preferências são isoladas por usuário", async () => {
  await mutate(
    front,
    "/preferences",
    { favorites: ["Cadastro de pacientes"], columns: ["birth"] },
    "patch",
  ).expect(200);
  assert.deepEqual((await front.get("/api/preferences")).body.columns, [
    "birth",
  ]);
  assert.equal((await nurse.get("/api/preferences")).body.columns, undefined);
});
test("Troca de perfil revoga sessão existente imediatamente", async () => {
  const created = await mutate(admin, "/users", {
    name: "Usuário fictício temporário",
    email: "temporario@demo.local",
    password,
    role_id: "recepcao",
  }).expect(201);
  const temp = request.agent(app.getHttpServer());
  await origin(temp.post("/api/auth/login"))
    .send({ email: "temporario@demo.local", password })
    .expect(201);
  await temp.get("/api/patients").expect(200);
  await mutate(
    admin,
    "/users/" + created.body.id,
    {
      active: true,
      role_id: "gestao",
      reason: "Revisão do vínculo institucional",
    },
    "patch",
  ).expect(200);
  await temp.get("/api/patients").expect(401);
});
test("Revogação explícita encerra todas as sessões do usuário", async () => {
  const u = (
    await db.query("SELECT id FROM users WHERE email='enfermagem@demo.local'")
  ).rows[0];
  await mutate(admin, `/users/${u.id}/revoke`, {
    reason: "Encerramento de acesso demonstrativo",
  }).expect(201);
  await nurse.get("/api/auth/me").expect(401);
});
test("Sessão expirada é negada", async () => {
  const a = request.agent(app.getHttpServer());
  await origin(a.post("/api/auth/login"))
    .send({ email: "medico@demo.local", password })
    .expect(201);
  await db.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email='medico@demo.local')",
  );
  await a.get("/api/auth/me").expect(401);
});
test("MFA obrigatório e código utilizado não é reutilizável", async () => {
  await origin(request(app.getHttpServer()).post("/api/auth/login"))
    .send({ email: "ti@demo.local", password })
    .expect(401);
  await origin(request(app.getHttpServer()).post("/api/auth/login"))
    .send({
      email: "ti@demo.local",
      password,
      otp: loginOtp,
    })
    .expect(401);
});
test("Auditoria encadeada é íntegra e imutável por DML comum", async () => {
  await assert.rejects(() =>
    db.query("UPDATE audit SET action='adulterado' WHERE id=1"),
  );
  const rows = (await db.query("SELECT * FROM audit ORDER BY id")).rows;
  let previous = "GENESIS";
  for (const row of rows) {
    const payload = [
      row.user_id,
      row.role_id,
      row.unit_id,
      row.action,
      row.resource,
      row.result,
      row.reason,
      row.correlation_id,
    ];
    assert.equal(row.previous_hash, previous);
    assert.equal(row.hash, digest(previous + JSON.stringify(payload)));
    previous = row.hash;
  }
  const response = await admin.get("/api/audit").expect(200);
  assert(response.body.total > 0);
  assert(!JSON.stringify(response.body).includes(password));
});
test("Logout invalida cookie e sessão", async () => {
  await mutate(front, "/auth/logout", {}).expect(201);
  await front.get("/api/auth/me").expect(401);
});
test("Tentativas abusivas são limitadas sem expor existência da conta", async () => {
  for (let i = 0; i < 8; i++)
    await origin(request(app.getHttpServer()).post("/api/auth/login"))
      .send({ email: "naoexiste@demo.local", password: "incorreta" })
      .expect(401);
  await origin(request(app.getHttpServer()).post("/api/auth/login"))
    .send({ email: "naoexiste@demo.local", password: "incorreta" })
    .expect(429);
});
test("Persistência em disco sobrevive ao fechamento e reabertura do banco", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aurora-test-"));
  process.env.PGLITE_PATH = path.join(dir, "db");
  let d = new Database();
  try {
    await d.migrate();
    await seed(d, password);
    await d.close();
    d = new Database();
    assert.equal(
      (await d.query("SELECT count(*) AS n FROM patients")).rows[0].n,
      6,
    );
  } finally {
    await d.close();
    process.env.PGLITE_PATH = "memory://";
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert(path.basename(dir).startsWith("aurora-test-"));
    await rm(dir, { recursive: true, force: true });
  }
});
