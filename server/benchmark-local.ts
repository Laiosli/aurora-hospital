import "reflect-metadata";
import request from "supertest";
import { performance } from "node:perf_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "./app";
import { Database } from "./db";
import { seed } from "./seed";
async function main() {
  // Always isolated synthetic data. Never reads connection settings from ERP.
  process.env.APP_ENV = "demonstracao";
  process.env.DB_MODE = "pglite";
  process.env.PGLITE_PATH = "memory://";
  process.env.APP_ORIGIN = "http://127.0.0.1:3000";
  process.env.DEMO_TI_FULL_ACCESS = "true";
  process.env.DEMO_DISABLE_TI_MFA = "true";
  process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.BACKUP_DIRECTORY = await mkdtemp(
    path.join(tmpdir(), "aurora-benchmark-"),
  );
  const app = await createApp(),
    db = app.get(Database);
  const password = "Senha-exclusiva-benchmark-ficticio";
  let queries = 0,
    queryMs = 0;
  try {
    await db.migrate();
    await seed(db, password);
    const ti = request.agent(app.getHttpServer());
    await ti
      .post("/api/auth/login")
      .set("Origin", process.env.APP_ORIGIN)
      .set("X-Requested-With", "Aurora")
      .send({ email: "ti@demo.local", password })
      .expect(201);
    const me = (await ti.get("/api/auth/me")).body;
    await db.query(
      "INSERT INTO patients(id,unit_id,name,provisional) SELECT md5('benchmark-ficticio-'||n)::uuid,$1,'Pessoa FICTÍCIA benchmark '||n,true FROM generate_series(1,1000) n",
      [me.unitId],
    );
    const originalQuery = db.query.bind(db),
      originalTransaction = db.transaction.bind(db);
    const timed = async (q: any, sql: string, params?: any[]) => {
      queries++;
      const start = performance.now();
      try {
        return await q(sql, params);
      } finally {
        queryMs += performance.now() - start;
      }
    };
    db.query = (sql, params) => timed(originalQuery, sql, params);
    db.transaction = (run) =>
      originalTransaction((q) =>
        run({ query: (sql, params) => timed(q.query.bind(q), sql, params) }),
      );
    const measure = async (concurrent: boolean) => {
      queries = 0;
      queryMs = 0;
      const times: number[] = [];
      const cpu = process.cpuUsage(),
        rss = process.memoryUsage();
      let failures = 0;
      const operation = async (i: number) => {
        const start = performance.now();
        const response = await ti.get(
          i % 2 ? "/api/patients?q=benchmark&page=1" : "/api/encounters?page=1",
        );
        times.push(performance.now() - start);
        if (response.status !== 200) failures++;
      };
      const start = performance.now();
      if (concurrent) {
        for (let i = 0; i < 4; i++)
          await Promise.all(
            Array.from({ length: 5 }, (_, j) => operation(i * 5 + j)),
          );
      } else for (let i = 0; i < 20; i++) await operation(i);
      times.sort((a, b) => a - b);
      return {
        requests: 20,
        concurrency: concurrent ? 5 : 1,
        p50Ms: times[9],
        p95Ms: times[18],
        elapsedMs: performance.now() - start,
        sqlStatements: queries,
        sqlAccumulatedMs: queryMs,
        failures,
        cpuMicroseconds: process.cpuUsage(cpu),
        memoryBefore: rss,
        memoryAfter: process.memoryUsage(),
      };
    };
    const before = await measure(false),
      concurrentBefore = await measure(true);
    const started = performance.now();
    const copy = await ti
      .post("/api/backups")
      .set("Origin", process.env.APP_ORIGIN)
      .set("X-Requested-With", "Aurora")
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "Benchmark sintético de continuidade" })
      .expect(201);
    const dumpMs = performance.now() - started;
    const verifyStart = performance.now();
    await ti
      .post(`/api/backups/${copy.body.id}/verify`)
      .set("Origin", process.env.APP_ORIGIN)
      .set("X-Requested-With", "Aurora")
      .send({ reason: "Restauração isolada do benchmark" })
      .expect(201);
    const restoreVerifyMs = performance.now() - verifyStart;
    const after = await measure(false),
      concurrentAfter = await measure(true);
    const report = {
      executedAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      scope:
        "Supertest HTTP + NestJS + PGlite em memória. Mesmo processo, dados sintéticos. Antes/depois da execução do backup e restauração isolada, não comparação entre versões ou fornecedores.",
      patients: 1006,
      before,
      concurrentBefore,
      backup: {
        dumpMs,
        restoreVerifyMs,
        encryptedBytes: copy.body.bytes,
        tableCount: Object.keys(copy.body.tables).length,
      },
      after,
      concurrentAfter,
      limits: [
        "Sem tempo visual de abertura de telas",
        "Sem PostgreSQL em rede ou produção",
        "CPU/memória são do processo de benchmark, sem pico monitorado",
        "Sem meta de capacidade homologada",
      ],
    };
    await writeFile(
      path.resolve("docs/medicoes-continuidade.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        patients: report.patients,
        beforeP95: before.p95Ms,
        afterP95: after.p95Ms,
        dumpMs,
        restoreVerifyMs,
        failures:
          before.failures +
          after.failures +
          concurrentBefore.failures +
          concurrentAfter.failures,
      }),
    );
  } finally {
    await app.close();
    await db.close();
  }
}
main().catch(() => {
  console.error(
    "Benchmark isolado falhou; consulte as verificações de continuidade.",
  );
  process.exitCode = 1;
});
