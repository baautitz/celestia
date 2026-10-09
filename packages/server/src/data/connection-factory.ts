import type { ConnectionRecord } from "./connection-store.js";
import { MssqlSourceConnector } from "./mssql-source-connector.js";
import { decryptSecret } from "./secret-box.js";
import type { SourceConnector } from "./source-connector.js";

export type ConnectorFactory = (record: ConnectionRecord) => SourceConnector;

export const createConnector: ConnectorFactory = (record) =>
  new MssqlSourceConnector({
    server: record.host,
    port: record.port,
    database: record.database,
    user: record.username,
    password: decryptSecret(record.passwordEncrypted),
    options: { encrypt: true, trustServerCertificate: false, readOnlyIntent: true },
    requestTimeout: 30000,
    pool: { max: 5 },
  });
