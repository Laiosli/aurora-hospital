import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Cooperative lock: acquire before opening PGlite. Old versions do not
// participate; deployment must first close any legacy process gracefully.
export function lockDatabase(directory: string) {
  const resolved = path.resolve(directory);
  mkdirSync(resolved, { recursive: true });
  const canonical = realpathSync(resolved);
  const lockPath = canonical + ".aurora-lock",
    token = randomUUID();
  try {
    mkdirSync(lockPath);
  } catch {
    throw new Error(
      "Banco reservado por outra instância ou bloqueio pendente. Consulte o procedimento de operação antes de abrir novamente.",
    );
  }
  try {
    writeFileSync(
      path.join(lockPath, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        token,
        startedAt: new Date().toISOString(),
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (e) {
    rmdirSync(lockPath);
    throw e;
  }
  return () => {
    const owner = JSON.parse(
      readFileSync(path.join(lockPath, "owner.json"), "utf8"),
    );
    if (owner.token !== token || owner.pid !== process.pid)
      throw new Error(
        "Proprietário do bloqueio mudou; bloqueio preservado para revisão.",
      );
    unlinkSync(path.join(lockPath, "owner.json"));
    rmdirSync(lockPath);
  };
}
