import type { ConnectionRecord } from "./connection-store.js";
import { ERP_TYPES } from "./erp-types.js";
import { decryptSecret } from "./secret-box.js";
import type { SourceConnector } from "./source-connector.js";

export type ConnectorFactory = (record: ConnectionRecord) => SourceConnector;

export function readSecrets(record: ConnectionRecord): Record<string, string> {
  return record.secretsEncrypted ? (JSON.parse(decryptSecret(record.secretsEncrypted)) as Record<string, string>) : {};
}

export const createConnector: ConnectorFactory = (record) => {
  const type = ERP_TYPES[record.type];
  if (!type) throw new Error(`Tipo de ERP '${record.type}' não suportado.`);
  return type.createConnector({ ...record.config, ...readSecrets(record) });
};
