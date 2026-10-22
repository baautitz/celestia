import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

// Cada Plugin tem a própria pasta de migrations, o próprio schema Postgres e a própria tabela de controle (ADR 0004).
async function run(): Promise<void> {
  await migrate(db, { migrationsFolder: "./drizzle" });

  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS closing_period`);
  await migrate(db, {
    migrationsFolder: "./src/closing-period/drizzle",
    migrationsTable: "__migrations_closing_period",
    migrationsSchema: "drizzle",
  });
}

run().finally(() => pool.end());
