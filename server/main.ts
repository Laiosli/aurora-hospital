import "dotenv/config";
import { createApp } from "./app";
import { Database } from "./db";
async function main() {
  const app = await createApp();
  const db = app.get(Database);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await db.close();
    if (process.connected) {
      process.send?.({ type: "stopped" });
      process.disconnect();
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  // Only the parent that launched this process with an IPC channel can request
  // shutdown. There is no public HTTP shutdown or inspector interface.
  process.on("message", (message: any) => {
    if (message?.type === "shutdown")
      void shutdown().catch(() => {
        process.exitCode = 1;
      });
  });
  try {
    await db.migrate();
    await app.listen(
      Number(process.env.PORT) || 3000,
      process.env.HOST || "127.0.0.1",
    );
    console.log(
      `Aurora disponível em http://127.0.0.1:${process.env.PORT || 3000} · ${process.env.APP_ENV || "demonstracao"}`,
    );
    process.send?.({ type: "ready" });
  } catch (e) {
    await shutdown();
    throw e;
  }
}
main().catch(() => {
  console.error(
    "Falha de inicialização. Verifique configuração, migração e disponibilidade do banco.",
  );
  process.exitCode = 1;
});
