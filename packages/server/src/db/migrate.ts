import { runModuleMigrations } from "@platform/core/migrations";
import { migrationPlan } from "../boot/compose.js";
import { createPlatform } from "../index.js";
import { db, pool } from "./client.js";

// Cada Module tem a própria pasta de migrations, o próprio schema Postgres e a própria tabela de controle.
// O boot só verifica (assertMigrationsUpToDate); aplicar é sempre explícito, por este comando.
async function run(): Promise<void> {
  const plan = migrationPlan(createPlatform().modules);
  const results = await runModuleMigrations(db, plan);
  for (const { moduleId, applied } of results) {
    if (applied.length > 0) {
      console.log(`[${moduleId}] migrations aplicadas: ${applied.join(", ")}`);
    } else {
      console.log(`[${moduleId}] nenhuma migration pendente.`);
    }
  }
}

run().finally(() => pool.end());
