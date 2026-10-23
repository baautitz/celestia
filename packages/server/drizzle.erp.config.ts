import { defineConfig } from "drizzle-kit";

// Migrations do Plugin `erp` (schema Postgres "erp"), aplicadas por runModuleMigrations.
export default defineConfig({
  out: "./src/erp/migrations",
  schema: "./src/erp/schema.ts",
  dialect: "postgresql",
});
