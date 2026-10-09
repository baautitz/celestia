import { parseArgs } from "node:util";
import { PostgresConnectionStore } from "../data/postgres-connection-store.js";
import { createConnector } from "../data/connection-factory.js";
import { db, pool } from "../db/client.js";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { limit: { type: "string", default: "50" } },
  });
  const [erpId, sql] = positionals;
  if (!erpId || !sql) {
    throw new Error('Uso: erp:query <id-do-erp> "<SELECT ...>" [--limit 50]');
  }

  const record = await new PostgresConnectionStore(db).get(erpId);
  if (!record) throw new Error(`ERP '${erpId}' não encontrado.`);

  const connector = createConnector(record);
  try {
    // A trava de somente leitura (SELECT/WITH) é aplicada pelo próprio conector.
    const rows = await connector.query<Record<string, unknown>>(sql);
    const limit = Number(values.limit);
    console.table(rows.slice(0, limit));
    console.log(`${rows.length} linha(s)${rows.length > limit ? ` (mostrando ${limit})` : ""}.`);
  } finally {
    await connector.close?.();
  }
}

main()
  .catch((err: Error) => {
    console.error(`Erro: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
