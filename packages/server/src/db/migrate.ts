import { migrate } from "drizzle-orm/node-postgres/migrator";
import { runModuleMigrations } from "@platform/core/migrations";
import { CLOSING_PERIOD_MIGRATIONS } from "../closing-period/closing-period-module.js";
import { ERP_MIGRATIONS } from "../erp/erp-module.js";
import { db, pool } from "./client.js";

// Cada Plugin tem a própria pasta de migrations, o próprio schema Postgres e a própria tabela de controle (ADR 0004).
// O boot só verifica (assertMigrationsUpToDate); aplicar é sempre explícito, por este comando.
async function run(): Promise<void> {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await runModuleMigrations(db, [
    { moduleId: "closing_period", ...CLOSING_PERIOD_MIGRATIONS },
    { moduleId: "erp", ...ERP_MIGRATIONS },
  ]);
}

run().finally(() => pool.end());
