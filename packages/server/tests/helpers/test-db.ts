import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/** Os testes contra Postgres real só rodam via `pnpm test:db`, que define estas variáveis. */
export const dbTestsEnabled = process.env.MIGRATIONS_TEST_DB === "1" && Boolean(process.env.POSTGRES_HOST);

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** Recusa qualquer banco que não seja local e descartável. */
export function assertDisposableDb(): void {
  if (!LOCAL_HOSTS.has(process.env.POSTGRES_HOST ?? "")) {
    throw new Error(`Recusado: POSTGRES_HOST "${process.env.POSTGRES_HOST}" não é local.`);
  }
  if (!/^[a-z_]*test[a-z_]*$/.test(process.env.POSTGRES_DB ?? "")) {
    throw new Error(`Recusado: POSTGRES_DB "${process.env.POSTGRES_DB}" não parece um banco de teste.`);
  }
}

export function createTestPool(): Pool {
  assertDisposableDb();
  return new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
}
