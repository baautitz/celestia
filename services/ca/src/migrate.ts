import { runModuleMigrations } from "@platform/core/migrations";
import { db, pool } from "./db.js";
import { CA_MIGRATIONS } from "./migrations.js";

// A CA tem a própria pasta de migrations, o próprio schema Postgres e a própria tabela de controle.
// O boot só verifica (assertMigrationsUpToDate); aplicar é sempre explícito, por este comando.
async function run(): Promise<void> {
  const [result] = await runModuleMigrations(db, [CA_MIGRATIONS]);
  console.log(result && result.applied.length > 0 ? `[ca] migrations aplicadas: ${result.applied.join(", ")}` : "[ca] nenhuma migration pendente.");
}

run().finally(() => pool.end());
