import "reflect-metadata";
import "dotenv/config";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { readBackup } from "./backups";
import { lockDatabase } from "./database-lock";
import { fingerprints } from "./snapshot";
async function main() {
  if (process.env.APP_ENV !== "demonstracao")
    throw new Error("Utilitário limitado ao ambiente demonstrativo.");
  const args = process.argv.slice(2),
    id = args[args.indexOf("--id") + 1],
    target = args[args.indexOf("--target") + 1];
  if (
    !args.includes("--id") ||
    !args.includes("--target") ||
    !target ||
    !path.isAbsolute(target)
  )
    throw new Error(
      "Informe --id IDENTIFICADOR --target DIRETORIO_ABSOLUTO_NOVO.",
    );
  try {
    await access(target);
    throw new Error(
      "O destino já existe. Nenhum diretório existente será substituído.",
    );
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const { sql, manifest } = await readBackup(id);
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(target);
  const release = lockDatabase(target),
    restored = new PGlite(target);
  try {
    await restored.exec(sql);
    const actual = await fingerprints(restored);
    if (JSON.stringify(actual) !== JSON.stringify(manifest.tables))
      throw new Error("Conteúdo restaurado divergiu do snapshot.");
    await writeFile(
      path.join(target, "AURORA-RESTORE.json"),
      JSON.stringify(
        {
          backupId: id,
          restoredAt: new Date().toISOString(),
          verified: true,
          tables: actual,
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      "Restauração verificada em diretório novo. Nenhuma configuração de aplicação foi trocada.",
    );
  } finally {
    await restored.close();
    release();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Falha na restauração.");
  process.exitCode = 1;
});
