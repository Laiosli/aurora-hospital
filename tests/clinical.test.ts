import "reflect-metadata";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import { Database } from "../server/db";
import { seed } from "../server/seed";
import { totp } from "../server/security";
import {demoFullAccess,demoMfaDisabled} from '../server/demo-access';
process.env.APP_ENV = "demonstracao";
process.env.DB_MODE = "pglite";
process.env.PGLITE_PATH = "memory://";
process.env.APP_ORIGIN = "http://127.0.0.1:3000";
process.env.ADMIN_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
let app: any,
  db: Database,
  doctor: any,
  nurse: any,
  reception: any,
  admin: any,
  patient: any,
  e: any,
  unit: string,
  sector: string,
  doc: any;
const password = "Senha-exclusiva-clinica-ficticia";
const origin = (r: any) =>
  r.set("Origin", process.env.APP_ORIGIN!).set("X-Requested-With", "Aurora");
const send = (a: any, url: string, b: any, key = randomUUID()) =>
  origin(a.post("/api" + url))
    .set("Idempotency-Key", key)
    .send(b);
const join = (a: any, episode = e) =>
  send(a, `/clinical/encounters/${episode.id}/join`, {
    confirmed_patient_id: patient.id,
    sector_id: sector,
    reason: "Equipe demonstrativa responsável",
  });
const transition = (action: string, extra: any = {}, agent = doctor) =>
  send(agent, `/clinical/documents/${doc.id}/transition`, {
    action,
    version: doc.version,
    confirmed_patient_id: patient.id,
    reason: "Revisão demonstrativa do registro",
    ...extra,
  });
before(async () => {
  app = await createApp();
  db = app.get(Database);
  await db.migrate();
  await seed(db, password);
  [doctor, nurse, reception, admin] = Array.from({ length: 4 }, () =>
    request.agent(app.getHttpServer()),
  );
  for (const [a, name] of [
    [doctor, "medico"],
    [nurse, "enfermagem"],
    [reception, "recepcao"],
    [admin, "ti"],
  ])
    await origin(a.post("/api/auth/login"))
      .send({
        email: name + "@demo.local",
        password,
        ...(name === "ti" ? { otp: totp(process.env.ADMIN_TOTP_SECRET!) } : {}),
      })
      .expect(201);
  unit = (await doctor.get("/api/auth/me")).body.unitId;
  sector = (await doctor.get("/api/sectors")).body[0].id;
  patient = (await doctor.get("/api/patients")).body.rows[0];
  await db.query(
    "UPDATE settings SET services=ARRAY['recepcao','ambulatorio'] WHERE unit_id=$1",
    [unit],
  );
  e = (
    await send(reception, "/encounters", {
      patient_id: patient.id,
      confirmed_patient_id: patient.id,
      sector_id: sector,
      modality: "ambulatorio",
    }).expect(201)
  ).body;
  for (const to of ["checked_in", "triage"])
    e = (
      await send(reception, `/encounters/${e.id}/transition`, {
        to,
        version: e.version,
        reason: "Encaminhamento demonstrativo",
      }).expect(201)
    ).body;
});
after(async () => {
  await app?.close();
  await db?.close();
});
test("Clínica: TI e recepção não consultam nem criam vínculo assistencial", async () => {
  for (const a of [admin, reception]) {
    await a.get(`/api/clinical/encounters/${e.id}`).expect(403);
    await join(a).expect(403);
  }
});
test("Clínica: profissional sem vínculo não lê conteúdo; identidade e setor exigidos", async () => {
  await doctor.get(`/api/clinical/encounters/${e.id}`).expect(403);
  await send(doctor, `/clinical/encounters/${e.id}/join`, {
    confirmed_patient_id: randomUUID(),
    sector_id: sector,
    reason: "Conferência demonstrativa",
  }).expect(409);
  await send(doctor, `/clinical/encounters/${e.id}/join`, {
    confirmed_patient_id: patient.id,
    sector_id: randomUUID(),
    reason: "Conferência demonstrativa",
  }).expect(409);
  await join(doctor).expect(201);
  await join(doctor).expect(201);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM care_links WHERE encounter_id=$1",
        [e.id],
      )
    ).rows[0].n,
    1,
  );
});
test("Clínica: cabeçalho identificado, alergia não investigada e leitura auditada", async () => {
  const r = await doctor.get(`/api/clinical/encounters/${e.id}`).expect(200);
  assert.equal(r.body.patient.id, patient.id);
  assert.equal(r.body.allergy.state, "not_investigated");
  assert.equal(r.body.total, 0);
  assert(
    (
      await db.query(
        "SELECT 1 FROM audit WHERE action='clinical.read' AND resource=$1",
        [e.id],
      )
    ).rows.length,
  );
});
test("Clínica: rascunho persistido, idempotência e histórico inicial", async () => {
  const key = randomUUID(),
    body = {
      confirmed_patient_id: patient.id,
      kind: "evolucao",
      content: "Registro fictício inicial, sem conduta real.",
    };
  const a = await send(
    doctor,
    `/clinical/encounters/${e.id}/documents`,
    body,
    key,
  ).expect(201);
  doc = a.body;
  const b = await send(
    doctor,
    `/clinical/encounters/${e.id}/documents`,
    body,
    key,
  ).expect(201);
  assert.equal(a.body.id, b.body.id);
  await send(
    doctor,
    `/clinical/encounters/${e.id}/documents`,
    { ...body, content: "Outro conteúdo fictício" },
    key,
  ).expect(409);
  const h = await doctor
    .get(`/api/clinical/documents/${doc.id}/history`)
    .expect(200);
  assert.equal(h.body.total, 1);
  assert.equal(h.body.rows[0].content, body.content);
});
test("Clínica: vínculo de outro profissional permite leitura, não edição da autoria", async () => {
  await nurse.get(`/api/clinical/documents/${doc.id}/history`).expect(403);
  await join(nurse).expect(201);
  await nurse.get(`/api/clinical/encounters/${e.id}`).expect(200);
  await transition(
    "update",
    { content: "Tentativa de alterar autoria" },
    nurse,
  ).expect(403);
});
test("Clínica: duas alterações concorrentes têm um vencedor e preservam versão anterior", async () => {
  const results = await Promise.all([
    transition("update", { content: "Revisão fictícia concorrente A" }),
    transition("update", { content: "Revisão fictícia concorrente B" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  doc = results.find((r) => r.status === 201)!.body;
  const h = await doctor
    .get(`/api/clinical/documents/${doc.id}/history`)
    .expect(200);
  assert.equal(h.body.total, 2);
  assert.match(h.body.rows[1].content, /inicial/);
});
test("Clínica: rascunho não pode ser retificado; confirmação protege finalização", async () => {
  await transition("rectify", {
    content: "Retificação prematura fictícia",
  }).expect(409);
  await transition("finalize", { confirmed_patient_id: randomUUID() }).expect(
    409,
  );
  await transition("finalize", {
    content: "Mudança disfarçada na finalização",
  }).expect(409);
  doc = (await transition("finalize").expect(201)).body;
  assert.equal(doc.status, "finalized");
  assert(doc.finalized_at);
});
test("Clínica: finalizado não admite edição direta e retificação preserva original", async () => {
  const original = doc.content;
  await transition("update", {
    content: "Alteração silenciosa proibida",
  }).expect(409);
  await assert.rejects(() =>
    db.query(
      "UPDATE clinical_documents SET status='draft',version=version+1 WHERE id=$1",
      [doc.id],
    ),
  );
  doc = (
    await transition("rectify", {
      content: "Texto fictício corrigido e rastreável",
    }).expect(201)
  ).body;
  const h = await doctor
    .get(`/api/clinical/documents/${doc.id}/history`)
    .expect(200);
  assert.equal(h.body.rows[0].status, "rectified");
  assert.equal(h.body.rows[1].content, original);
  assert.equal(h.body.rows[1].status, "finalized");
  await assert.rejects(() =>
    db.query("DELETE FROM clinical_revisions WHERE document_id=$1", [doc.id]),
  );
  await assert.rejects(() =>
    db.query("DELETE FROM clinical_documents WHERE id=$1", [doc.id]),
  );
});
test("Clínica: isolamento entre unidades e referência direta inexistente", async () => {
  const other = (await db.query("SELECT id FROM units WHERE id<>$1", [unit]))
    .rows[0].id;
  await doctor
    .get(`/api/clinical/encounters/${e.id}`)
    .set("X-Unit-Id", other)
    .expect(403);
  await doctor.get(`/api/clinical/encounters/${randomUUID()}`).expect(404);
  await doctor
    .get(`/api/clinical/documents/${randomUUID()}/history`)
    .expect(404);
});
test("Clínica: permissão revogada afeta sessão existente", async () => {
  await db.query(
    "UPDATE roles SET permissions=array_remove(permissions,'clinical.finalize') WHERE id='medico'",
  );
  await transition("finalize").expect(403);
  await db.query(
    "UPDATE roles SET permissions=array_append(permissions,'clinical.finalize') WHERE id='medico'",
  );
});
test("Clínica: avaliações de alergia distinguem estados, exigem reações e preservam história", async () => {
  const base = {
    confirmed_patient_id: patient.id,
    reason: "Avaliação fictícia de alergias",
  };
  await send(doctor, `/clinical/encounters/${e.id}/allergies`, {
    ...base,
    version: 0,
    state: "recorded",
    entries: [],
  }).expect(400);
  await send(doctor, `/clinical/encounters/${e.id}/allergies`, {
    ...base,
    version: 0,
    state: "none_known",
    entries: [],
  }).expect(201);
  await send(doctor, `/clinical/encounters/${e.id}/allergies`, {
    ...base,
    version: 1,
    state: "unavailable",
    entries: [],
  }).expect(201);
  await send(doctor, `/clinical/encounters/${e.id}/allergies`, {
    ...base,
    version: 2,
    state: "recorded",
    entries: [
      {
        substance: "Substância fictícia",
        reaction: "Reação fictícia relatada",
      },
    ],
  }).expect(201);
  const chart = (
    await doctor.get(`/api/clinical/encounters/${e.id}`).expect(200)
  ).body;
  assert.equal(chart.allergy.state, "recorded");
  assert.equal(chart.allergy.version, 3);
  const history = (
    await doctor
      .get(`/api/clinical/encounters/${e.id}/allergies/history`)
      .expect(200)
  ).body;
  assert.deepEqual(
    history.rows.map((r: any) => r.state),
    ["recorded", "unavailable", "none_known"],
  );
  await send(doctor, `/clinical/encounters/${e.id}/allergies`, {
    ...base,
    version: 1,
    state: "none_known",
    entries: [],
  }).expect(409);
  await reception
    .get(`/api/clinical/encounters/${e.id}/allergies/history`)
    .expect(403);
  await assert.rejects(() =>
    db.query("DELETE FROM allergy_assessments WHERE patient_id=$1", [
      patient.id,
    ]),
  );
});
test("Clínica: avaliação concorrente de alergias tem um vencedor", async () => {
  const body = {
    confirmed_patient_id: patient.id,
    version: 3,
    state: "none_known",
    entries: [],
    reason: "Reavaliação fictícia concorrente",
  };
  const r = await Promise.all([
    send(doctor, `/clinical/encounters/${e.id}/allergies`, body),
    send(nurse, `/clinical/encounters/${e.id}/allergies`, body),
  ]);
  assert.deepEqual(r.map((x) => x.status).sort(), [201, 409]);
});
test("Clínica: sinais vitais têm unidade fixa, horário válido, idempotência e retificação imutável", async () => {
  const body = {
    confirmed_patient_id: patient.id,
    kind: "temperature",
    value: "36.500",
    observed_at: new Date().toISOString(),
    reason: "Medição fictícia para teste",
  };
  await send(doctor, `/clinical/encounters/${e.id}/vitals`, {
    ...body,
    measurement_unit: "mg",
  }).expect(400);
  await send(doctor, `/clinical/encounters/${e.id}/vitals`, {
    ...body,
    value: "NaN",
  }).expect(400);
  await send(doctor, `/clinical/encounters/${e.id}/vitals`, {
    ...body,
    observed_at: new Date(Date.now() + 86400000).toISOString(),
  }).expect(400);
  await send(doctor, `/clinical/encounters/${e.id}/vitals`, {
    ...body,
    observed_at: "2020-01-01T00:00:00Z",
  }).expect(409);
  const key = randomUUID(),
    v = (
      await send(
        doctor,
        `/clinical/encounters/${e.id}/vitals`,
        body,
        key,
      ).expect(201)
    ).body;
  assert.equal(v.measurement_unit, "°C");
  assert.equal(
    (
      await send(
        doctor,
        `/clinical/encounters/${e.id}/vitals`,
        body,
        key,
      ).expect(201)
    ).body.id,
    v.id,
  );
  await send(nurse, `/clinical/encounters/${e.id}/vitals`, {
    ...body,
    value: "36.600",
    replaces_id: v.id,
  }).expect(403);
  const r = await Promise.all([
    send(doctor, `/clinical/encounters/${e.id}/vitals`, {
      ...body,
      value: "36.600",
      replaces_id: v.id,
    }),
    send(doctor, `/clinical/encounters/${e.id}/vitals`, {
      ...body,
      value: "36.700",
      replaces_id: v.id,
    }),
  ]);
  assert.deepEqual(r.map((x) => x.status).sort(), [201, 409]);
  const list = (
    await doctor.get(`/api/clinical/encounters/${e.id}/vitals`).expect(200)
  ).body;
  assert.equal(list.total, 2);
  assert.equal(list.rows.find((x: any) => x.id === v.id).superseded, true);
  await reception.get(`/api/clinical/encounters/${e.id}/vitals`).expect(403);
  await assert.rejects(() =>
    db.query("UPDATE vital_observations SET value=99 WHERE id=$1", [v.id]),
  );
});
test("Clínica: encerramento impede novo registro mas permite retificação identificada", async () => {
  for (const to of ["waiting", "in_care", "discharged"])
    e = (
      await send(doctor, `/encounters/${e.id}/transition`, {
        to,
        version: e.version,
        reason: "Encerramento operacional fictício",
      }).expect(201)
    ).body;
  await send(doctor, `/clinical/encounters/${e.id}/documents`, {
    confirmed_patient_id: patient.id,
    kind: "evolucao",
    content: "Registro tardio novo não permitido",
  }).expect(409);
  await join(doctor).expect(409);
  doc = (
    await transition("rectify", {
      content: "Retificação fictícia após encerramento",
    }).expect(201)
  ).body;
  await doctor.get(`/api/clinical/encounters/${e.id}`).expect(200);
});
test("Clínica: cancelamento preserva conteúdo e bloqueia novas transições", async () => {
  const original = doc.content;
  doc = (await transition("cancel").expect(201)).body;
  assert.equal(doc.status, "cancelled");
  assert.equal(doc.content, original);
  await transition("rectify", {
    content: "Não deve gravar após cancelamento",
  }).expect(409);
  await transition("cancel").expect(409);
  const history = await doctor
    .get(`/api/clinical/documents/${doc.id}/history`)
    .expect(200);
  assert.equal(history.body.total, doc.version);
  assert.equal(history.body.rows[0].status, "cancelled");
});

test('Demonstração: TI entra sem MFA e tem acesso completo somente com configuração explícita', async () => {
 process.env.DEMO_TI_FULL_ACCESS='true'; process.env.DEMO_DISABLE_TI_MFA='true';
 try {
  const ti=request.agent(app.getHttpServer());
  await origin(ti.post('/api/auth/login')).send({email:'ti@demo.local',password}).expect(201);
  const me=(await ti.get('/api/auth/me').expect(200)).body;
  assert(me.demoFullAccess); assert(me.permissions.includes('patients.create')); assert(me.permissions.includes('clinical.read'));
  await ti.get(`/api/clinical/encounters/${e.id}`).expect(200);
  await ti.get(`/api/clinical/documents/${doc.id}/history`).expect(200);
  await ti.get('/api/patients').expect(200);
  assert.equal((await ti.get('/api/health')).body.tiMfaRequired,false);
  process.env.APP_ENV='homologacao';
  assert.equal(demoFullAccess({role_id:'ti'}),false); assert.equal(demoMfaDisabled(),false);
 } finally {
  process.env.APP_ENV='demonstracao';delete process.env.DEMO_TI_FULL_ACCESS;delete process.env.DEMO_DISABLE_TI_MFA;
 }
});
