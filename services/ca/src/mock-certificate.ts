import type { Context } from "hono";
import type { DeviceStore } from "./device-store.js";

/**
 * SÓ PARA DESENVOLVIMENTO: finge que toda requisição veio do Dispositivo ativo com o nome informado, para quem
 * exige certificado entrar pelo Vite sem TLS nem proxy. Sem o nome, ninguém apresenta certificado (útil para ver a
 * negação). O carregamento da configuração recusa esta fonte em produção.
 */
export function createMockCertificateReader({
  deviceStore,
  deviceName,
}: {
  deviceStore: DeviceStore;
  deviceName?: string;
}): (c: Context) => Promise<string | undefined> {
  return async () => {
    if (!deviceName) return undefined;
    const devices = await deviceStore.list();
    return devices.find((d) => d.status === "active" && d.name === deviceName)?.fingerprint;
  };
}
