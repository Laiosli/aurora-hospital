import "reflect-metadata";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import { Database } from "../server/db";
import { seed } from "../server/seed";
import { totp } from "../server/security";
import { unitInstant, unitLocal } from "../web/time";

process.env.APP_ENV = "demonstracao";
process.env.DB_MODE = "pglite";
process.env.PGLITE_PATH = "memory://";
process.env.APP_ORIGIN = "http://127.0.0.1:3000";
process.env.ADMIN_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const password = "Senha-exclusiva-testes-operacionais";
let app: any,
  db: Database,
  admin: any,
  reception: any,
  doctor: any,
  unit: string,
  sector: string,
  patient: any,
  other: any,
  room: any,
  schedule: any,
  appointment: any,
  episode: any,
  bed1: any,
  bed2: any;
const tomorrow = new Date(Date.now() + 86400000 * 2);
tomorrow.setUTCHours(12, 0, 0, 0);
const at = (minutes: number) =>
  new Date(+tomorrow + minutes * 60000).toISOString();
const origin = (r: any) =>
  r.set("Origin", process.env.APP_ORIGIN!).set("X-Requested-With", "Aurora");
const send = (
  agent: any,
  url: string,
  body: any,
  method = "post",
  key = randomUUID(),
) =>
  origin(agent[method]("/api" + url))
    .set("Idempotency-Key", key)
    .send(body);
const open = async (p: any) => {
  const r = await send(reception, "/encounters", {
    patient_id: p.id,
    confirmed_patient_id: p.id,
    sector_id: sector,
    modality: "ambulatorio",
  }).expect(201);
  return r.body;
};
const move = async (agent: any, e: any, to: string) => {
  const r = await send(agent, `/encounters/${e.id}/transition`, {
    to,
    version: e.version,
    reason: "Transição demonstrativa validada",
  }).expect(201);
  return r.body;
};
const toCare = async (p: any) => {
  let e = await open(p);
  e = await move(reception, e, "checked_in");
  e = await move(reception, e, "triage");
  e = await move(doctor, e, "waiting");
  return move(doctor, e, "in_care");
};
before(async () => {
  app = await createApp();
  db = app.get(Database);
  await db.migrate();
  await seed(db, password);
  admin = request.agent(app.getHttpServer());
  reception = request.agent(app.getHttpServer());
  doctor = request.agent(app.getHttpServer());
  for (const [agent, email] of [
    [admin, "ti"],
    [reception, "recepcao"],
    [doctor, "medico"],
  ] as const)
    await origin(agent.post("/api/auth/login"))
      .send({
        email: email + "@demo.local",
        password,
        ...(email === "ti"
          ? { otp: totp(process.env.ADMIN_TOTP_SECRET!) }
          : {}),
      })
      .expect(201);
  unit = (await reception.get("/api/auth/me")).body.unitId;
  sector = (await reception.get("/api/sectors")).body[0].id;
  const ps = (await reception.get("/api/patients")).body.rows;
  patient = ps[0];
  other = ps[1];
});
after(async () => {
  await app?.close();
  await db?.close();
});
test("Migrações incrementais são idempotentes e preservam cadastros", async () => {
  const before = (await db.query("SELECT count(*) AS n FROM patients")).rows[0]
    .n;
  await db.migrate();
  const versions = (
    await db.query(
      "SELECT version,checksum FROM schema_migrations ORDER BY version",
    )
  ).rows;
  assert.deepEqual(
    versions.map((v) => v.version),
    [1, 2, 3, 4, 5],
  );
  assert(versions.every((v) => v.checksum.length === 64));
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM patients")).rows[0].n,
    before,
  );
});
test("Modalidade desligada bloqueia abertura sem impedir cadastros", async () => {
  await send(reception, "/encounters", {
    patient_id: patient.id,
    confirmed_patient_id: patient.id,
    sector_id: sector,
    modality: "ambulatorio",
  }).expect(409);
  await reception.get("/api/patients").expect(200);
  const cfg = (await admin.get("/api/settings")).body;
  await send(
    admin,
    "/settings",
    {
      services: ["recepcao", "ambulatorio", "internacao"],
      version: cfg.version,
      reason: "Habilitação para testes fictícios",
    },
    "patch",
  ).expect(200);
});
test("Sala e agenda exigem perfil de configuração e vínculo do profissional", async () => {
  await send(reception, "/rooms", {
    name: "Sala proibida",
    sector_id: sector,
  }).expect(403);
  room = (
    await send(admin, "/rooms", {
      name: "Consultório fictício",
      sector_id: sector,
    }).expect(201)
  ).body;
  const professionals = (await admin.get("/api/resources")).body.professionals;
  const b = {
    name: "Agenda fictícia",
    specialty: "Clínica demonstrativa",
    room_id: room.id,
    professional_id: professionals[0].id,
    slot_minutes: 30,
    starts_at: at(0),
    ends_at: at(480),
  };
  schedule = (await send(admin, "/schedules", b).expect(201)).body;
  await send(admin, "/schedules", {
    ...b,
    professional_id: (await admin.get("/api/auth/me")).body.id,
  }).expect(400);
});
test("Agendamento exige conferência e respeita duração; disputa tem um vencedor", async () => {
  await send(reception, "/appointments", {
    patient_id: patient.id,
    confirmed_patient_id: other.id,
    schedule_id: schedule.id,
    starts_at: at(0),
  }).expect(400);
  const [a, b] = await Promise.all([
    send(reception, "/appointments", {
      patient_id: patient.id,
      confirmed_patient_id: patient.id,
      schedule_id: schedule.id,
      starts_at: at(0),
    }),
    send(reception, "/appointments", {
      patient_id: other.id,
      confirmed_patient_id: other.id,
      schedule_id: schedule.id,
      starts_at: at(0),
    }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  appointment = (a.status === 201 ? a : b).body;
  assert.equal(
    Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at),
    30 * 60000,
  );
});
test("Conflito de sala/profissional se mantém entre agendas diferentes", async () => {
  const s = (
    await send(admin, "/schedules", {
      name: "Agenda sobreposta",
      specialty: "Outro serviço",
      room_id: room.id,
      professional_id: schedule.professional_id,
      slot_minutes: 30,
      starts_at: at(0),
      ends_at: at(480),
    }).expect(201)
  ).body;
  await send(reception, "/appointments", {
    patient_id: patient.id,
    confirmed_patient_id: patient.id,
    schedule_id: s.id,
    starts_at: at(15),
  }).expect(409);
});
test("Bloqueio rejeita consulta existente e impede criação em intervalo indisponível", async () => {
  await send(admin, `/schedules/${schedule.id}/blocks`, {
    starts_at: at(0),
    ends_at: at(60),
    reason: "Manutenção de demonstração",
  }).expect(409);
  await send(admin, `/schedules/${schedule.id}/blocks`, {
    starts_at: at(90),
    ends_at: at(120),
    reason: "Manutenção de demonstração",
  }).expect(201);
  await send(reception, "/appointments", {
    patient_id: patient.id,
    confirmed_patient_id: patient.id,
    schedule_id: schedule.id,
    starts_at: at(90),
  }).expect(409);
  await send(reception, "/appointments", {
    patient_id: patient.id,
    confirmed_patient_id: patient.id,
    schedule_id: schedule.id,
    starts_at: at(470),
  }).expect(400);
});
test("Reagendamento preserva horário anterior, bloqueia versão velha e falta antecipada", async () => {
  const b = {
    action: "reschedule",
    version: appointment.version,
    reason: "Reagendamento solicitado fictício",
    starts_at: at(30),
  };
  const next = await send(
    reception,
    `/appointments/${appointment.id}`,
    b,
    "patch",
  ).expect(200);
  await send(reception, `/appointments/${appointment.id}`, b, "patch").expect(
    409,
  );
  appointment = next.body;
  const h = (
    await reception.get(`/api/operations/appointment/${appointment.id}/history`)
  ).body.rows;
  assert(
    h.some((e: any) => e.action === "reschedule" && e.details.previousStart),
  );
  await send(
    reception,
    `/appointments/${appointment.id}`,
    {
      action: "no_show",
      version: appointment.version,
      reason: "Falta antes da hora prevista",
    },
    "patch",
  ).expect(409);
});
test("Check-in repetido cria apenas um episódio e atualiza agenda atomicamente", async () => {
  const key = randomUUID(),
    body = {
      patient_id: appointment.patient_id,
      confirmed_patient_id: appointment.patient_id,
      appointment_id: appointment.id,
      sector_id: sector,
      modality: "ambulatorio",
    };
  const [a, b] = await Promise.all([
    send(reception, "/encounters", body, "post", key),
    send(reception, "/encounters", body, "post", key),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.body.id, b.body.id);
  episode = a.body;
  assert.equal(episode.status, "checked_in");
  assert.equal(
    (
      await db.query("SELECT status FROM appointments WHERE id=$1", [
        appointment.id,
      ])
    ).rows[0].status,
    "checked_in",
  );
  await send(reception, "/encounters", body).expect(409);
});
test("Transições são explícitas e enfermagem/médico controlam início assistencial", async () => {
  await send(reception, `/encounters/${episode.id}/transition`, {
    to: "discharged",
    version: episode.version,
    reason: "Pular etapas proibido",
  }).expect(409);
  episode = await move(reception, episode, "triage");
  await send(reception, `/encounters/${episode.id}/transition`, {
    to: "waiting",
    version: episode.version,
    reason: "Recepção sem permissão clínica",
  }).expect(403);
  episode = await move(doctor, episode, "waiting");
  episode = await move(doctor, episode, "in_care");
  const history = (
    await reception.get(`/api/operations/encounter/${episode.id}/history`)
  ).body;
  assert.equal(history.total, 4);
});
test("Leitos são cadastrados sem permitir identidade do paciente ao administrador técnico", async () => {
  bed1 = (
    await send(admin, "/beds", { code: "DEMO-01", sector_id: sector }).expect(
      201,
    )
  ).body;
  const ward=(await send(admin,'/sectors',{name:'Setor destino da transferência'}).expect(201)).body;
  bed2 = (
    await send(admin, "/beds", { code: "DEMO-02", sector_id: ward.id }).expect(
      201,
    )
  ).body;
  const list = (await admin.get("/api/beds")).body.rows;
  assert(
    list.every((b: any) => !("patient_name" in b) && !("encounter_id" in b)),
  );
  await admin.get("/api/encounters").expect(403);
});
test("Duas ocupações incompatíveis têm apenas um vencedor e restrição no banco", async () => {
  const otherEpisode = await toCare(other);
  const [a, b] = await Promise.all([
    send(reception, `/beds/${bed1.id}/allocate`, {
      encounter_id: episode.id,
      mode: "occupy",
      version: bed1.version,
      reason: "Admissão demonstrativa autorizada",
    }),
    send(reception, `/beds/${bed1.id}/allocate`, {
      encounter_id: otherEpisode.id,
      mode: "occupy",
      version: bed1.version,
      reason: "Outra admissão concorrente",
    }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const winner = (a.status === 201 ? a : b).body;
  bed1.version = winner.version;
  const row = (
    await db.query(
      "SELECT * FROM bed_allocations WHERE bed_id=$1 AND status='occupied'",
      [bed1.id],
    )
  ).rows[0];
  assert(row);
  episode = (
    await db.query("SELECT * FROM encounters WHERE id=$1", [row.encounter_id])
  ).rows[0];
  await assert.rejects(() =>
    db.query(
      "INSERT INTO bed_allocations(id,unit_id,bed_id,encounter_id,status,created_by) VALUES($1,$2,$3,$4,'occupied',$5)",
      [
        randomUUID(),
        unit,
        bed1.id,
        otherEpisode.id,
        (a.status === 201 ? otherEpisode : episode).created_by,
      ],
    ),
  );
});
test("Transferência bloqueada não libera origem; transferência válida deixa origem em higienização", async () => {
  const blocked = (
    await send(admin, `/beds/${bed2.id}/state`, {
      action: "block",
      version: bed2.version,
      reason: "Interdição para teste de falha",
    }).expect(201)
  ).body;
  await send(reception, `/beds/${bed2.id}/allocate`, {
    encounter_id: episode.id,
    mode: "transfer",
    version: blocked.version,
    reason: "Destino bloqueado não deve transferir",
  }).expect(409);
  assert.equal(
    (await db.query("SELECT state FROM beds WHERE id=$1", [bed1.id])).rows[0]
      .state,
    "occupied",
  );
  bed2 = (
    await send(admin, `/beds/${bed2.id}/state`, {
      action: "unblock",
      version: blocked.version,
      reason: "Liberação após teste de bloqueio",
    }).expect(201)
  ).body;
  await send(reception, `/beds/${bed2.id}/allocate`, {
    encounter_id: episode.id,
    mode: "transfer",
    version: bed2.version,
    reason: "Transferência operacional autorizada",
  }).expect(201);
  assert.equal(
    (await db.query("SELECT state FROM beds WHERE id=$1", [bed1.id])).rows[0]
      .state,
    "cleaning",
  );
  assert.equal(
    (await db.query("SELECT state FROM beds WHERE id=$1", [bed2.id])).rows[0]
      .state,
    "occupied",
  );
});
test("Alta libera leito para higienização; apenas perfil autorizado conclui a limpeza", async () => {
  episode = (
    await db.query("SELECT * FROM encounters WHERE id=$1", [episode.id])
  ).rows[0];
  assert.equal(episode.sector_id,bed2.sector_id,'Transferência deve atualizar setor do episódio para o do leito destino');
  await send(reception, `/encounters/${episode.id}/transition`, {
    to: "discharged",
    version: episode.version,
    reason: "Recepção não pode dar alta",
  }).expect(403);
  episode = await move(doctor, episode, "discharged");
  assert(episode.ended_at);
  bed2 = (await db.query("SELECT * FROM beds WHERE id=$1", [bed2.id])).rows[0];
  assert.equal(bed2.state, "cleaning");
  await send(reception, `/beds/${bed2.id}/state`, {
    action: "clean",
    version: bed2.version,
    reason: "Recepção não pode concluir limpeza",
  }).expect(403);
  bed2 = (
    await send(doctor, `/beds/${bed2.id}/state`, {
      action: "clean",
      version: bed2.version,
      reason: "Higienização fictícia concluída",
    }).expect(201)
  ).body;
  assert.equal(bed2.state, "available");
});
test("Reserva cancelada e cancelamento de episódio não deixam leito retido", async () => {
  const e = await open(patient);
  const allocated = (
    await send(reception, `/beds/${bed2.id}/allocate`, {
      encounter_id: e.id,
      mode: "reserve",
      version: bed2.version,
      reason: "Reserva para planejamento fictício",
    }).expect(201)
  ).body;
  await move(reception, e, "cancelled");
  const b = (await db.query("SELECT * FROM beds WHERE id=$1", [bed2.id]))
    .rows[0];
  assert.equal(b.state, "available");
  assert.equal(b.version, allocated.version + 1);
});
test("Indicadores refletem episódios e ocupação persistidos, sem nomes de pacientes", async () => {
  const metrics = (await admin.get("/api/operations/metrics").expect(200)).body;
  assert(metrics.encounters >= 3);
  assert.equal(metrics.occupiedBeds, 0);
  assert.equal(metrics.occupancy, 0);
  assert(!JSON.stringify(metrics).includes(patient.name));
});
test("Histórico não permite alteração e unidades não podem ser forjadas", async () => {
  await assert.rejects(() =>
    db.query("UPDATE operational_events SET reason='alterado'"),
  );
  const north = (await admin.get("/api/units")).body.find(
    (u: any) => u.id !== unit,
  );
  await reception.get("/api/encounters").set("X-Unit-Id", north.id).expect(403);
  const foreign = (
    await db.query("SELECT id FROM patients WHERE unit_id=$1", [north.id])
  ).rows[0];
  await send(reception, "/encounters", {
    patient_id: foreign.id,
    confirmed_patient_id: foreign.id,
    sector_id: sector,
    modality: "ambulatorio",
  }).expect(404);
  await reception
    .get("/api/operations/encounter/" + randomUUID() + "/history")
    .expect(404);
});
test('Cancelamento de consulta libera horário e confirmação conserva vínculo',async()=>{
 const body={patient_id:patient.id,confirmed_patient_id:patient.id,schedule_id:schedule.id,starts_at:at(180)};
 let a=(await send(reception,'/appointments',body).expect(201)).body;
 a=(await send(reception,`/appointments/${a.id}`,{action:'confirm',version:a.version,reason:'Confirmação fictícia do agendamento'},'patch').expect(200)).body;
 assert.equal(a.status,'confirmed');
 await send(reception,`/appointments/${a.id}`,{action:'cancel',version:a.version,reason:'Cancelamento solicitado na demonstração'},'patch').expect(200);
 const replacement=(await send(reception,'/appointments',body).expect(201)).body;
 assert.notEqual(replacement.id,a.id);
});
test('Reserva pode ser cancelada explicitamente e ocupação preserva a mesma alocação',async()=>{
 let e=await open(patient);
 let b=(await db.query('SELECT * FROM beds WHERE id=$1',[bed2.id])).rows[0];
 const reserved=(await send(reception,`/beds/${b.id}/allocate`,{encounter_id:e.id,mode:'reserve',version:b.version,reason:'Reserva demonstrativa temporária'}).expect(201)).body;
 b=(await send(reception,`/beds/${b.id}/state`,{action:'cancel_reservation',version:reserved.version,reason:'Cancelamento da reserva fictícia'}).expect(201)).body;
 assert.equal(b.state,'available');
 const again=(await send(reception,`/beds/${b.id}/allocate`,{encounter_id:e.id,mode:'reserve',version:b.version,reason:'Nova reserva para ocupação'}).expect(201)).body;
 e=await move(reception,e,'checked_in');e=await move(reception,e,'waiting');e=await move(doctor,e,'in_care');
 const occupied=(await send(reception,`/beds/${b.id}/allocate`,{encounter_id:e.id,mode:'occupy',version:again.version,reason:'Conferência antes de ocupar reserva'}).expect(201)).body;
 assert.equal(occupied.allocation_id,again.allocation_id);
 e=(await db.query('SELECT * FROM encounters WHERE id=$1',[e.id])).rows[0];await move(doctor,e,'discharged');
});
test('Checksum divergente interrompe migração sem alterar dados',async()=>{
 const original=(await db.query('SELECT checksum FROM schema_migrations WHERE version=2')).rows[0].checksum;
 await db.query("UPDATE schema_migrations SET checksum='incorreto' WHERE version=2");
 try{await assert.rejects(()=>db.migrate(),/Checksum divergente/);}finally{await db.query('UPDATE schema_migrations SET checksum=$1 WHERE version=2',[original]);}
});
test("Encerramento existente continua possível se o serviço for desabilitado", async () => {
  const e = await open(patient);
  const cfg = (await admin.get("/api/settings")).body;
  await send(
    admin,
    "/settings",
    {
      services: ["recepcao"],
      version: cfg.version,
      reason: "Desativação de novos atendimentos",
    },
    "patch",
  ).expect(200);
  await move(reception, e, "cancelled");
  await send(reception, "/encounters", {
    patient_id: patient.id,
    confirmed_patient_id: patient.id,
    sector_id: sector,
    modality: "ambulatorio",
  }).expect(409);
});
test("Conversão de data usa fuso da unidade, preserva instante e rejeita transição ambígua", () => {
  assert.equal(
    unitInstant("2026-10-30T09:00", "America/Sao_Paulo"),
    "2026-10-30T12:00:00.000Z",
  );
  assert.equal(
    unitLocal("2026-10-30T12:00:00Z", "America/Sao_Paulo"),
    "2026-10-30T09:00",
  );
  assert.throws(() => unitInstant("2026-03-08T02:30", "America/New_York"));
  assert.throws(() => unitInstant("2026-11-01T01:30", "America/New_York"));
});
