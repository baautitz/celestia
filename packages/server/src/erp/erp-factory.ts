import type { ErpClient } from "./erp-client.js";
import { ERP_DRIVERS, type ErpDriverDef } from "./erp-drivers.js";
import type { ErpRecord } from "./erp-store.js";
import { decryptSecret } from "./secret-box.js";

export type ErpClientFactory = (record: ErpRecord) => ErpClient;

export function readSecrets(record: ErpRecord): Record<string, string> {
  return record.secretsEncrypted ? (JSON.parse(decryptSecret(record.secretsEncrypted)) as Record<string, string>) : {};
}

export function createErpClientFactory(drivers: Record<string, ErpDriverDef> = ERP_DRIVERS): ErpClientFactory {
  return (record) => {
    const driver = drivers[record.driver];
    if (!driver) throw new Error(`ERP Driver '${record.driver}' não suportado.`);
    return driver.createClient({ ...record.config, ...readSecrets(record) });
  };
}

export const createErpClient: ErpClientFactory = (record) => createErpClientFactory()(record);
