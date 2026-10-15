import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { topoSort } from "./graph.js";

export type ModuleMigrations = { moduleId: string; folder: string; schema?: string };
export type MigrationsDb = NodePgDatabase;
export type MigrationResult = { moduleId: string; applied: string[] };

const IDENT = /^[a-z][a-z0-9_]*$/;
/** Tabelas de controle ficam neste schema (separado dos schemas dos módulos). */
export const CONTROL_SCHEMA = "drizzle";

function ident(kind: string, v: string): string {
  if (!IDENT.test(v)) {
    throw new Error(`${kind} inválido "${v}": use apenas [a-z][a-z0-9_]*.`);
  }
  return v;
}

export function planMigrations(
  modules: { id: string; dependsOn?: string[]; migrations?: ModuleMigrations }[],
): ModuleMigrations[] {
  return topoSort(modules).flatMap((m) => (m.migrations ? [m.migrations] : []));
}

function controlTable(m: ModuleMigrations): string {
  return `__migrations_${ident("moduleId", m.moduleId)}`;
}

/** Migrations locais ainda não registradas na tabela de controle do módulo (por nome, como o drizzle). */
async function pending(db: MigrationsDb, m: ModuleMigrations): Promise<string[]> {
  const table = controlTable(m);
  const local = readMigrationFiles({ migrationsFolder: m.folder }).map((x) => x.name);
  const exists = await db.execute<{ r: string | null }>(
    sql`select to_regclass(${`"${CONTROL_SCHEMA}"."${table}"`}) as r`,
  );
  if (!exists.rows[0]?.r) return local;
  const done = await db.execute<{ name: string | null }>(
    sql`select name from ${sql.identifier(CONTROL_SCHEMA)}.${sql.identifier(table)}`,
  );
  const names = new Set(done.rows.map((r) => r.name));
  return local.filter((n) => !names.has(n));
}

/** `applied` = migrations aplicadas nesta execução (com dryRun: as pendentes, nada é aplicado). */
export async function runModuleMigrations(
  db: MigrationsDb,
  plan: ModuleMigrations[],
  options: { dryRun?: boolean } = {},
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];
  for (const m of plan) {
    const schema = ident("schema", m.schema ?? m.moduleId);
    const table = controlTable(m);
    if (options.dryRun) {
      results.push({ moduleId: m.moduleId, applied: await pending(db, m) });
      continue;
    }
    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(schema)}`);
    const before = await pending(db, m);
    await migrate(db, {
      migrationsFolder: m.folder,
      migrationsTable: table,
      migrationsSchema: CONTROL_SCHEMA,
    });
    results.push({ moduleId: m.moduleId, applied: before });
  }
  return results;
}

export async function assertMigrationsUpToDate(db: MigrationsDb, plan: ModuleMigrations[]): Promise<void> {
  for (const m of plan) {
    const p = await pending(db, m);
    if (p.length) {
      throw new Error(
        `Migrations pendentes no módulo "${m.moduleId}": ${p.join(", ")}. Execute o comando de migração explicitamente.`,
      );
    }
  }
}
