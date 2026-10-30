import { Database } from "./db";
async function main() {
  const db = new Database();
  try {
    await db.migrate();
    console.log(
      "Migrações disponíveis aplicadas ou já existentes, com checksum validado.",
    );
  } finally {
    await db.close();
  }
}
main().catch(() => {
  console.error("Migração falhou. Verifique banco e configuração.");
  process.exitCode = 1;
});
