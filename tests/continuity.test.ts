import "reflect-metadata";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { Database } from "../server/db";
import { createApp } from "../server/app";
import { seed } from "../server/seed";
import { totp } from "../server/security";
import { lockDatabase } from "../server/database-lock";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { readBackup, verifyLogicalBackup } from "../server/backups";

process.env.APP_ENV = "demonstracao";
process.env.DB_MODE = "pglite";
process.env.PGLITE_PATH = "memory://";
process.env.APP_ORIGIN = "http://127.0.0.1:3000";
process.env.ADMIN_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString("base64");
let temp: string, app: any, db: Database, ti: any, reception: any, copy: any;
const password = "Senha-ficticia-teste-continuidade";
const origin = (r: any) =>
  r.set("Origin", process.env.APP_ORIGIN!).set("X-Requested-With", "Aurora");
const send = (agent: any, url: string, body: any, key = randomUUID()) =>
  origin(agent.post("/api" + url))
    .set("Idempotency-Key", key)
    .send(body);
before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aurora-continuity-"));
  process.env.BACKUP_DIRECTORY = path.join(temp, "backups");
  app = await createApp();
  db = app.get(Database);
  await db.migrate();
  await seed(db, password);
  ti = request.agent(app.getHttpServer());
  reception = request.agent(app.getHttpServer());
  for (const [a, name] of [
    [ti, "ti"],
    [reception, "recepcao"],
  ])
    await origin(a.post("/api/auth/login"))
      .send({
        email: name + "@demo.local",
        password,
        ...(name === "ti" ? { otp: totp(process.env.ADMIN_TOTP_SECRET!) } : {}),
      })
      .expect(201);
});
after(async () => {
  await app?.close();
  await db?.close();
});
test("Continuidade: bloqueio exclusivo recusa segundo processo e aliases de caminho", async () => {
  const directory = path.join(temp, "locked");
  const release = lockDatabase(directory);
  assert.throws(
    () => lockDatabase(path.join(directory, "..", "locked")),
    /reservado/,
  );
  release();
  const again = lockDatabase(directory);
  again();
  await assert.rejects(() => access(directory + ".aurora-lock"));
});
test("Continuidade: duas instâncias do banco não podem abrir o mesmo diretório", async () => {
  const old = process.env.PGLITE_PATH;
  process.env.PGLITE_PATH = path.join(temp, "persisted");
  const first = new Database();
  try {
    await first.query("CREATE TABLE preserved(id integer PRIMARY KEY)");
    await first.query("INSERT INTO preserved VALUES(71)");
    assert.throws(() => new Database(), /reservado/);
  } finally {
    await first.close();
  }
  const second = new Database();
  try {
    assert.equal(
      (await second.query("SELECT id FROM preserved")).rows[0].id,
      71,
    );
    await Promise.all([second.close(), second.close()]);
  } finally {
    process.env.PGLITE_PATH = old;
  }
});
test("Continuidade: backup é restrito e chave ausente bloqueia sem falsa confirmação", async () => {
  await reception.get("/api/backups").expect(403);
  await send(reception, "/backups", {
    reason: "Tentativa sem permissão",
  }).expect(403);
  const k = process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.BACKUP_ENCRYPTION_KEY;
  try {
    await send(ti, "/backups", {
      reason: "Teste sem chave configurada",
    }).expect(503);
  } finally {
    process.env.BACKUP_ENCRYPTION_KEY = k;
  }
});
test("Continuidade: backup criptografado é idempotente e contém snapshot consistente", async () => {
  const key = randomUUID(),
    body = { reason: "Cópia demonstrativa para restauração isolada" };
  const response = await send(ti, "/backups", body, key);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  copy = response.body;
  assert.equal(copy.status, "complete");
  assert(copy.tables.patients.rows >= 6);
  const repeated = (await send(ti, "/backups", body, key).expect(201)).body;
  assert.equal(repeated.id, copy.id);
  await send(
    ti,
    "/backups",
    { reason: "Outra justificativa de backup" },
    key,
  ).expect(409);
  const file = await readFile(
    path.join(process.env.BACKUP_DIRECTORY!, copy.id + ".enc"),
  );
  assert(!file.includes(Buffer.from("CREATE TABLE")));
  assert(!file.includes(Buffer.from("password_hash")));
  assert((await readBackup(copy.id)).sql.includes("CREATE TABLE"));
});
test("Continuidade: restauração isolada compara todas as tabelas e não altera origem", async () => {
  const patients = JSON.stringify(
    (await db.query("SELECT id,version FROM patients ORDER BY id")).rows,
  );
  const result = await send(ti, `/backups/${copy.id}/verify`, {
    reason: "Verificação demonstrativa de restauração",
  }).expect(201);
  assert.equal(result.body.verification.status, "verified");
  assert.equal(
    JSON.stringify(
      (await db.query("SELECT id,version FROM patients ORDER BY id")).rows,
    ),
    patients,
  );
  assert(
    (
      await db.query(
        "SELECT 1 FROM audit WHERE action='backup.restore.verified' AND resource=$1",
        [copy.id],
      )
    ).rows.length,
  );
});
test("Continuidade: utilitário restaura em novo diretório e recusa sobrepor destino", async () => {
  const target = path.join(temp, "restored-copy");
  const args = [
    "dist/server/restore-backup.js",
    "--id",
    copy.id,
    "--target",
    target,
  ];
  await promisify(execFile)(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
  });
  const receipt = JSON.parse(
    await readFile(path.join(target, "AURORA-RESTORE.json"), "utf8"),
  );
  assert.equal(receipt.verified, true);
  const restored = new PGlite(target);
  try {
    assert.equal(
      Number(
        (await restored.query("SELECT count(*) AS n FROM public.patients"))
          .rows[0].n,
      ),
      copy.tables.patients.rows,
    );
  } finally {
    await restored.close();
  }
  await assert.rejects(() =>
    promisify(execFile)(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
    }),
  );
});
test("Continuidade: arquivo adulterado é recusado e resultado de falha é registrado", async () => {
  const file = path.join(process.env.BACKUP_DIRECTORY!, copy.id + ".enc"),
    original = await readFile(file),
    changed = Buffer.from(original);
  changed[changed.length - 2] ^= 1;
  await writeFile(file, changed);
  try {
    await assert.rejects(() => verifyLogicalBackup(copy.id), /alterado/);
    await send(ti, `/backups/${copy.id}/verify`, {
      reason: "Teste de integridade da cópia alterada",
    }).expect(409);
    const list = (await ti.get("/api/backups").expect(200)).body;
    assert.equal(list.rows[0].verification.status, "failed");
  } finally {
    await writeFile(file, original);
  }
});
