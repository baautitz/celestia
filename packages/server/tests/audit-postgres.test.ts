import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { runModuleMigrations } from "@platform/core/migrations";
import { AuditLog } from "../src/audit/audit-log.js";
import { AUDIT_MIGRATIONS } from "../src/audit/audit-module.js";
import { PostgresAuditStore } from "../src/audit/postgres-audit-store.js";
import { createTestPool, dbTestsEnabled } from "./helpers/test-db.js";

const plan = [{ moduleId: "audit", ...AUDIT_MIGRATIONS }];

describe.skipIf(!dbTestsEnabled)("Audit Log contra Postgres real", () => {
  let pool: Pool;
  let db: NodePgDatabase;
  let log: AuditLog;

  beforeAll(async () => {
    pool = createTestPool();
    db = drizzle({ client: pool });
    await runModuleMigrations(db, plan);
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE audit.audit_log_entries`);
    log = new AuditLog(new PostgresAuditStore(db));
    log.declareAction({ plugin: "erp", action: "a", schemaVersion: 1, schema: z.object({ n: z.number() }), summary: (x) => `n=${x.n}` });
  });
  afterAll(async () => {
    await pool?.end();
  });

  const rec = (targetId: string, at: string) =>
    log.record({ plugin: "erp", action: "a", actor: { id: "u1", name: "Ana" }, target: { type: "t", id: targetId }, attributes: { n: 1 }, occurredAt: new Date(at) });

  it("grava, filtra e ordena do mais recente ao mais antigo", async () => {
    await rec("x", "2026-01-01T00:00:00Z");
    await rec("y", "2026-02-01T00:00:00Z");
    expect((await log.list({})).map((e) => e.targetId)).toEqual(["y", "x"]);
    expect(await log.list({ targetType: "t", targetId: "x", actorId: "u1", plugin: "erp", from: new Date("2025-12-01"), to: new Date("2026-01-15") })).toHaveLength(1);
    expect((await log.list({}))[0]).toMatchObject({ attributes: { n: 1 }, schemaVersion: 1, summary: "n=1", actorName: "Ana" });
  });

  it("o banco recusa alterar ou remover entradas", async () => {
    await rec("x", "2026-01-01T00:00:00Z");
    await expect(db.execute(sql`UPDATE audit.audit_log_entries SET summary = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM audit.audit_log_entries`)).rejects.toThrow();
  });
});
