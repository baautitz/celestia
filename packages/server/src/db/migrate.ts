import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ERP_MIGRATIONS } from "../erp/erp-module.js";
import { db, pool } from "./client.js";

// Mesma tabela de controle que runModuleMigrations (@platform/core/migrations) usa para o Plugin `erp`.
migrate(db, { migrationsFolder: "./drizzle" })
  .then(() =>
    migrate(db, { migrationsFolder: ERP_MIGRATIONS.folder, migrationsSchema: "drizzle", migrationsTable: "__migrations_erp" }),
  )
  .finally(() => pool.end());
