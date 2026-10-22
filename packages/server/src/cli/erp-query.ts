import { parseArgs } from "node:util";
import { PostgresErpStore } from "../erp/postgres-erp-store.js";
import { createErpClient } from "../erp/erp-factory.js";
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

  const record = await new PostgresErpStore(db).get(erpId);
  if (!record) throw new Error(`ERP '${erpId}' não encontrado.`);

  const client = createErpClient(record);
  try {
    // A trava de somente leitura (SELECT/WITH) é aplicada pelo próprio cliente.
    const rows = await client.query<Record<string, unknown>>(sql);
    const limit = Number(values.limit);
    console.table(rows.slice(0, limit));
    console.log(`${rows.length} linha(s)${rows.length > limit ? ` (mostrando ${limit})` : ""}.`);
  } finally {
    await client.close?.();
  }
}

main()
  .catch((err: Error) => {
    console.error(`Erro: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
