import { defineConfig } from "drizzle-kit";

// Migrations do Plugin closing_period: uma pasta e um schema Postgres próprios (ADR 0004).
export default defineConfig({
  out: "./src/closing-period/drizzle",
  schema: "./src/closing-period/schema.ts",
  dialect: "postgresql",
  schemaFilter: ["closing_period"],
});
