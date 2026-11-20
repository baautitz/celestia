import { serve } from "@hono/node-server";
import { pino } from "pino";
import { assertMigrationsUpToDate } from "@platform/core/migrations";
import { createCaApp } from "./app.js";
import { DeviceCertificateAuthority } from "./authority.js";
import { certificateReader, loadCaConfig } from "./config.js";
import { MemoryDeviceStore, type DeviceStore } from "./device-store.js";
import { CA_MIGRATIONS } from "./migrations.js";

const logger = pino({ name: "celestia-ca", level: process.env.LOG_LEVEL ?? "info" });

// Falha antes de qualquer outra coisa: em produção, sem a configuração completa a CA não sobe.
const config = loadCaConfig();

let deviceStore: DeviceStore;
let closeDatabase: () => Promise<void> = async () => {};
if (process.env.POSTGRES_HOST) {
  const [{ db, pool }, { PostgresDeviceStore }] = await Promise.all([import("./db.js"), import("./postgres-device-store.js")]);
  // Verifica (sem aplicar) que as migrations estão em dia; aplicar é por `pnpm --filter @platform/ca db:migrate` ou pelo start.sh da imagem.
  await assertMigrationsUpToDate(db, [CA_MIGRATIONS]);
  deviceStore = new PostgresDeviceStore(db);
  closeDatabase = () => pool.end();
} else {
  deviceStore = new MemoryDeviceStore();
}

const app = createCaApp({
  deviceStore,
  authority: config.authority && new DeviceCertificateAuthority(config.authority),
  sharedSecret: config.sharedSecret,
  publicUrl: config.publicUrl,
  callbackUrl: config.callbackUrl,
  readCertificate: certificateReader(config, deviceStore),
  logger,
});

if (config.source === "mock") {
  logger.warn(
    { mockDevice: config.mock?.deviceName ?? null },
    "Certificado simulado (só desenvolvimento): %s",
    config.mock?.deviceName ? "toda leitura vale como o Dispositivo configurado" : "ninguém apresenta certificado",
  );
}

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  logger.info({ port: config.port, source: config.source }, "Autoridade certificadora no ar");
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Encerrando a autoridade certificadora");
  server.close((err) => {
    closeDatabase()
      .catch((closeError: unknown) => logger.error({ err: closeError }, "Falha ao fechar o banco"))
      .finally(() => {
        if (err) logger.error({ err }, "Falha ao encerrar o servidor");
        process.exit(err ? 1 : 0);
      });
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
