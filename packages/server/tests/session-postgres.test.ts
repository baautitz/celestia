import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { runModuleMigrations } from "@platform/core/migrations";
import { IAM_MIGRATIONS } from "../src/iam/iam-module.js";
import { PostgresSessionStore } from "../src/iam/postgres-session-store.js";
import type { SessionRecord } from "../src/iam/session-store.js";
import { createTestPool, dbTestsEnabled } from "./helpers/test-db.js";

describe.skipIf(!dbTestsEnabled)("SessionStore contra Postgres real", () => {
  let pool: Pool;
  let db: NodePgDatabase;
  let store: PostgresSessionStore;

  beforeAll(async () => {
    pool = createTestPool();
    db = drizzle({ client: pool });
    await runModuleMigrations(db, [{ moduleId: "iam", ...IAM_MIGRATIONS }]);
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE iam.sessions, iam.users, iam.roles CASCADE`);
    await db.execute(sql`INSERT INTO iam.roles (id, name) VALUES ('r', 'R')`);
    await db.execute(sql`INSERT INTO iam.users (id, fullname, username, password_hash, role_id) VALUES ('u1', 'Ana', 'ana', 'x', 'r')`);
    store = new PostgresSessionStore(db);
  });
  afterAll(async () => {
    await pool?.end();
  });

  const record = (tokenHash: string, overrides: Partial<SessionRecord> = {}): SessionRecord => ({
    tokenHash,
    userId: "u1",
    userSessionVersion: 0,
    familyId: "f1",
    issuedAt: 1_000,
    expiresAt: 10_000,
    ...overrides,
  });

  it("guarda e devolve o registro pelo hash, nunca por um token em claro", async () => {
    await store.insert(record("h1", { deviceId: "d1" }));
    expect(await store.find("h1")).toEqual(record("h1", { deviceId: "d1" }));
    expect(await store.find("token-em-claro")).toBeUndefined();
  });

  it("marcar como usado é atômico: de duas requisições simultâneas, só uma ganha", async () => {
    await store.insert(record("h1"));
    const results = await Promise.all([store.markUsed("h1", 2_000), store.markUsed("h1", 2_001)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.find("h1"))?.usedAt).toBeDefined();
  });

  it("bloqueia e revoga só a família pedida", async () => {
    await store.insert(record("a1"));
    await store.insert(record("a2"));
    await store.insert(record("b1", { familyId: "f2" }));
    await store.lockFamily("f1", 5_000);
    expect((await store.find("a1"))?.lockedAt).toBe(5_000);
    expect((await store.find("a2"))?.lockedAt).toBe(5_000);
    expect((await store.find("b1"))?.lockedAt).toBeUndefined();

    await store.revokeFamily("f1");
    expect(await store.find("a1")).toBeUndefined();
    expect(await store.find("b1")).toBeDefined();
  });

  it("apaga só os expirados na limpeza", async () => {
    await store.insert(record("velho", { expiresAt: 5_000 }));
    await store.insert(record("novo", { expiresAt: 50_000 }));
    await store.purgeExpired(10_000);
    expect(await store.find("velho")).toBeUndefined();
    expect(await store.find("novo")).toBeDefined();
  });

  it("excluir o usuário leva as sessões dele junto", async () => {
    await store.insert(record("h1"));
    await db.execute(sql`DELETE FROM iam.users WHERE id = 'u1'`);
    expect(await store.find("h1")).toBeUndefined();
  });
});
