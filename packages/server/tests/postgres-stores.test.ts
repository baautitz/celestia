import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { assertMigrationsUpToDate, runModuleMigrations } from "@platform/core/migrations";
import { PostgresUserStore } from "../src/iam/postgres-user-store.js";
import { PostgresErpStore } from "../src/erp/postgres-erp-store.js";
import { ERP_MIGRATIONS } from "../src/erp/erp-module.js";
import { PostgresWorkspaceStore } from "../src/data/postgres-workspace-store.js";
import { createTestPool, dbTestsEnabled } from "./helpers/test-db.js";

const plan = [
  { moduleId: "server", folder: resolve(import.meta.dirname, "../drizzle") },
  { moduleId: "erp", ...ERP_MIGRATIONS },
];

describe.skipIf(!dbTestsEnabled)("stores contra Postgres real", () => {
  // Criados no beforeAll: o corpo do describe roda mesmo quando a suíte é ignorada.
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pool = createTestPool();
    db = drizzle({ client: pool });
    await runModuleMigrations(db, plan);
    await assertMigrationsUpToDate(db, plan);
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE users, roles, erp.erps, workspaces CASCADE`);
  });
  afterAll(async () => {
    await pool?.end();
  });

  describe("Users e Roles", () => {
    it("cria role e usuário, sem expor passwordHash na listagem", async () => {
      const store = new PostgresUserStore(db);
      await store.createRole({ id: "r1", name: "Operador", permissions: ["system:users:read"] });
      const user = await store.createUser({ fullname: "Ana", username: "Ana", password: "Abcdef1!", roleId: "r1" });
      expect((await store.findByUsername("ANA"))?.id).toBe(user.id);
      const [listed] = await store.listUsers();
      expect(listed).not.toHaveProperty("passwordHash");
    });
    it("recusa username duplicado, role inexistente e exclusão de role em uso", async () => {
      const store = new PostgresUserStore(db);
      await store.createRole({ id: "r1", name: "Operador", permissions: [] });
      await store.createUser({ fullname: "Ana", username: "ana", password: "Abcdef1!", roleId: "r1" });
      await expect(
        store.createUser({ fullname: "Outra", username: "ana", password: "Abcdef1!", roleId: "r1" }),
      ).rejects.toThrow(/já existe/);
      await expect(
        store.createUser({ fullname: "B", username: "b", password: "Abcdef1!", roleId: "nope" }),
      ).rejects.toThrow(/não encontrada/);
      await expect(store.deleteRole("r1")).rejects.toThrow(/usuários vinculados/);
    });
    it("setAdmin e syncOrphanPermissions persistem", async () => {
      const store = new PostgresUserStore(db);
      await store.createRole({ id: "r1", name: "Op", permissions: ["system:users:read", "legacy:gone", "*"] });
      const user = await store.createUser({ fullname: "A", username: "a", password: "Abcdef1!", roleId: "r1" });
      await store.setAdmin(user.id, true);
      expect((await store.findById(user.id))?.isAdmin).toBe(true);
      expect(await store.syncOrphanPermissions(new Set(["system:users:read"]))).toBe(1);
      expect((await store.getRole("r1"))?.permissions).toEqual(["system:users:read", "*"]);
    });
  });

  describe("ERPs", () => {
    it("salva (upsert), lê, lista e remove", async () => {
      const store = new PostgresErpStore(db);
      const input = { id: "c1", name: "ERP", driver: "mssql", config: { host: "h" }, secretsEncrypted: "x" };
      const first = await store.save(input);
      const second = await store.save({ ...input, name: "ERP 2" });
      expect(second.createdAt).toBe(first.createdAt);
      expect((await store.get("c1"))?.name).toBe("ERP 2");
      expect(await store.list()).toHaveLength(1);
      await store.delete("c1");
      expect(await store.get("c1")).toBeNull();
    });
  });

  describe("Closing Periods (workspaces)", () => {
    it("salva (upsert), lista e remove", async () => {
      const store = new PostgresWorkspaceStore(db);
      const ws = {
        id: "w1",
        name: "Out/2026",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        status: "open" as const,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      };
      await store.save(ws);
      await store.save({ ...ws, status: "closed" });
      expect(await store.list()).toEqual([{ ...ws, status: "closed" }]);
      await store.remove("w1");
      expect(await store.list()).toEqual([]);
    });
  });
});
