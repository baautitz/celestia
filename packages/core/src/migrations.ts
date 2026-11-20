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

/** Valida os identificadores do plano (módulo e schema), para o dry-run e o `run` recusarem o mesmo que o banco recusaria. */
function validated(m: ModuleMigrations): ModuleMigrations {
  ident("moduleId", m.moduleId);
  ident("schema", m.schema ?? m.moduleId);
  return m;
}

export function planMigrations(
  modules: { id: string; dependsOn?: string[]; migrations?: ModuleMigrations }[],
): ModuleMigrations[] {
  return topoSort(modules).flatMap((m) => (m.migrations ? [validated(m.migrations)] : []));
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

/**
 * Roda `work` com um lock consultivo (por módulo) do Postgres, para que `db:migrate`, o boot do servidor e o `start.sh`
 * da CA não apliquem as mesmas migrations ao mesmo tempo. O lock é de transação (`pg_advisory_xact_lock`): fica numa
 * única conexão, é solto no commit/rollback e também se a conexão cair, sem risco de lock órfão.
 * Quem espera o lock só consulta as pendentes depois de obtê-lo, então enxerga o que o outro processo já aplicou.
 */
function withMigrationLock<T>(db: MigrationsDb, moduleId: string, work: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`celestia:migrations:${moduleId}`}))`);
    return work();
  });
}

/** `applied` = migrations que ESTE processo aplicou (com dryRun: as pendentes, nada é aplicado). */
export async function runModuleMigrations(
  db: MigrationsDb,
  plan: ModuleMigrations[],
  options: { dryRun?: boolean } = {},
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];
  for (const m of plan) {
    const schema = ident("schema", validated(m).schema ?? m.moduleId);
    const table = controlTable(m);
    if (options.dryRun) {
      results.push({ moduleId: m.moduleId, applied: await pending(db, m) });
      continue;
    }
    const applied = await withMigrationLock(db, m.moduleId, async () => {
      await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(schema)}`);
      const before = await pending(db, m);
      await migrate(db, {
        migrationsFolder: m.folder,
        migrationsTable: table,
        migrationsSchema: CONTROL_SCHEMA,
      });
      return before;
    });
    results.push({ moduleId: m.moduleId, applied });
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
