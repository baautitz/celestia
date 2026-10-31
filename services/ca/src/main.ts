import { serve } from "@hono/node-server";
import { assertMigrationsUpToDate } from "@platform/core/migrations";
import { createCaApp } from "./app.js";
import { DeviceCertificateAuthority } from "./authority.js";
import { certificateReader, loadCaConfig } from "./config.js";
import { MemoryDeviceStore, type DeviceStore } from "./device-store.js";
import { CA_MIGRATIONS } from "./migrations.js";

// Falha antes de qualquer outra coisa: em produção, sem a configuração completa a CA não sobe.
const config = loadCaConfig();

let deviceStore: DeviceStore;
if (process.env.POSTGRES_HOST) {
  const [{ db }, { PostgresDeviceStore }] = await Promise.all([import("./db.js"), import("./postgres-device-store.js")]);
  // Verifica (sem aplicar) que as migrations estão em dia; aplicar é por `pnpm --filter @platform/ca db:migrate` ou pelo start.sh da imagem.
  await assertMigrationsUpToDate(db, [CA_MIGRATIONS]);
  deviceStore = new PostgresDeviceStore(db);
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
});

const notes = {
  header: "atrás do proxy: o certificado vem do header repassado por ele",
  mock: `⚠️  CERTIFICADO SIMULADO (só desenvolvimento): ${config.mock?.deviceName ? `toda leitura vale como o Dispositivo "${config.mock.deviceName}"` : "ninguém apresenta certificado"}`,
} as const;
console.log(`🔏 Autoridade certificadora em http://localhost:${config.port} (${notes[config.source]})`);
serve({ fetch: app.fetch, port: config.port });
