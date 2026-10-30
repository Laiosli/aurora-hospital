import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { Database } from "../server/db";
test("Ciclo real: segundo processo é recusado, IPC fecha banco e permite reabertura preservada", async () => {
  process.env.DB_MODE = "pglite";
  process.env.APP_ENV = "demonstracao";
  const target = path.join(
    await mkdtemp(path.join(tmpdir(), "aurora-lifecycle-")),
    "db",
  );
  process.env.PGLITE_PATH = target;
  const db = new Database();
  await db.migrate();
  await db.query("CREATE TABLE lifecycle_probe(id integer PRIMARY KEY)");
  await db.query("INSERT INTO lifecycle_probe VALUES(87)");
  await db.close();
  const port = await new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const n = (s.address() as any).port;
      s.close(() => resolve(n));
    });
  });
  const spawn = () =>
    fork(path.resolve("dist/server/main.js"), [], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      silent: true,
      windowsHide: true,
    });
  const child = spawn();
  let errors = "";
  child.stderr?.on("data", (v) => (errors += v.toString()));
  const stopped = new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error("Servidor não ficou pronto: " + errors.slice(-200))),
        30000,
      );
      child.on("message", (m: any) => {
        if (m.type === "ready") {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Servidor encerrou antes de ficar pronto"));
      });
    });
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/api/health`)).status,
      200,
    );
    const duplicate = spawn();
    duplicate.stdout?.resume();
    duplicate.stderr?.resume();
    const rejected = await new Promise<number | null>((resolve) =>
      duplicate.once("exit", resolve),
    );
    assert.notEqual(rejected, 0);
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/api/health`)).status,
      200,
    );
  } finally {
    if (child.connected) child.send({ type: "shutdown" });
    await stopped;
  }
  await assert.rejects(() => access(target + ".aurora-lock"));
  const reopened = new Database();
  try {
    assert.equal(
      (await reopened.query("SELECT id FROM lifecycle_probe")).rows[0].id,
      87,
    );
  } finally {
    await reopened.close();
  }
});
