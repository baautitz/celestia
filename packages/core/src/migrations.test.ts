import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";

const migrateMock = vi.hoisted(() => vi.fn());
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: migrateMock }));

import { assertMigrationsUpToDate, planMigrations, runModuleMigrations, type MigrationsDb } from "./migrations.js";

const mig = (id: string) => ({ moduleId: id, folder: "/x/" + id });

describe("planMigrations", () => {
  it("ordena por dependsOn e ignora módulos sem migrations", () => {
    const p = planMigrations([
      { id: "b", dependsOn: ["a"], migrations: mig("b") },
      { id: "c" },
      { id: "a", migrations: mig("a") },
    ]);
    expect(p.map((x) => x.moduleId)).toEqual(["a", "b"]);
  });
  it("ciclo e dependência desconhecida", () => {
    expect(() => planMigrations([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }])).toThrow(/circular/);
    expect(() => planMigrations([{ id: "a", dependsOn: ["z"] }])).toThrow(/não existe/);
  });
});

function fakeDb(): { db: MigrationsDb; calls: string[] } {
  const calls: string[] = [];
  const dialect = new PgDialect();
  const fake = {
    execute: async (q: SQL) => {
      const s = dialect.sqlToQuery(q).sql;
      calls.push(s);
      return { rows: s.includes("to_regclass") ? [{ r: null }] : [] };
    },
  };
  return { db: fake as unknown as MigrationsDb, calls };
}

describe("runModuleMigrations (db falso)", () => {
  it("cria schema citado, usa tabela de controle e respeita a ordem", async () => {
    migrateMock.mockReset();
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    mkdirSync(join(dir, "20240101000000_init"));
    writeFileSync(join(dir, "20240101000000_init", "migration.sql"), "select 1");
    const { db, calls } = fakeDb();
    const r = await runModuleMigrations(db, [
      { moduleId: "a", folder: dir },
      { moduleId: "b", folder: dir, schema: "bs" },
    ]);
    expect(calls.filter((c) => c.startsWith("CREATE SCHEMA"))).toEqual([
      'CREATE SCHEMA IF NOT EXISTS "a"',
      'CREATE SCHEMA IF NOT EXISTS "bs"',
    ]);
    expect(migrateMock.mock.calls.map((c) => c[1])).toEqual([
      { migrationsFolder: dir, migrationsTable: "__migrations_a", migrationsSchema: "drizzle" },
      { migrationsFolder: dir, migrationsTable: "__migrations_b", migrationsSchema: "drizzle" },
    ]);
    expect(r).toEqual([
      { moduleId: "a", applied: ["20240101000000_init"] },
      { moduleId: "b", applied: ["20240101000000_init"] },
    ]);
    await expect(assertMigrationsUpToDate(db, [{ moduleId: "a", folder: dir }])).rejects.toThrow(
      /"a".*20240101000000_init/,
    );
  });
  it("rejeita identificadores perigosos antes de tocar o banco", async () => {
    const { db, calls } = fakeDb();
    await expect(runModuleMigrations(db, [{ moduleId: "a", folder: "/x", schema: "public; drop" }])).rejects.toThrow(
      /inválido/,
    );
    await expect(runModuleMigrations(db, [{ moduleId: "a;b", folder: "/x" }])).rejects.toThrow(/inválido/);
    expect(calls).toEqual([]);
  });
});

describe.skipIf(!process.env.POSTGRES_HOST || process.env.MIGRATIONS_TEST_DB !== "1")("Postgres real (opt-in)", () => {
  it("aplica e verifica uma migration trivial", async () => {
    const real = await vi.importActual<typeof import("drizzle-orm/node-postgres/migrator")>(
      "drizzle-orm/node-postgres/migrator",
    );
    migrateMock.mockImplementation(real.migrate);
    const db = drizzle({
      connection: {
        host: process.env.POSTGRES_HOST,
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB,
      },
    });
    const id = `t4_${Date.now()}`;
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    mkdirSync(join(dir, "20240101000000_t"));
    writeFileSync(join(dir, "20240101000000_t", "migration.sql"), `CREATE TABLE "${id}"."t" (id int)`);
    const plan = [{ moduleId: id, folder: dir }];
    try {
      await expect(assertMigrationsUpToDate(db, plan)).rejects.toThrow();
      expect(await runModuleMigrations(db, plan)).toEqual([{ moduleId: id, applied: ["20240101000000_t"] }]);
      await assertMigrationsUpToDate(db, plan);
    } finally {
      await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(id)} CASCADE`);
      await db.execute(sql`DROP TABLE IF EXISTS drizzle.${sql.identifier("__migrations_" + id)}`);
    }
  });
});
