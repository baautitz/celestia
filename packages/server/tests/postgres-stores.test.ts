import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { assertMigrationsUpToDate, runModuleMigrations } from "@platform/core/migrations";
import { PostgresUserStore } from "../src/iam/postgres-user-store.js";
import { LastAdminError } from "../src/iam/user-store.js";
import { PasswordService } from "../src/iam/password-service.js";
import { PostgresConnectionStore } from "../src/data/postgres-connection-store.js";
import { PostgresClosingPeriodStore } from "../src/closing-period/postgres-closing-period-store.js";
import { createTestPool, dbTestsEnabled } from "./helpers/test-db.js";

const plan = [
  { moduleId: "server", folder: resolve(import.meta.dirname, "../drizzle") },
  { moduleId: "closing_period", folder: resolve(import.meta.dirname, "../src/closing-period/drizzle") },
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
    await db.execute(sql`TRUNCATE users, roles, connections, closing_period.periods CASCADE`);
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

  describe("ERPs (connections)", () => {
    it("salva (upsert), lê, lista e remove", async () => {
      const store = new PostgresConnectionStore(db);
      const input = { id: "c1", name: "ERP", type: "mssql", config: { host: "h" }, secretsEncrypted: "x" };
      const first = await store.save(input);
      const second = await store.save({ ...input, name: "ERP 2" });
      expect(second.createdAt).toBe(first.createdAt);
      expect((await store.get("c1"))?.name).toBe("ERP 2");
      expect(await store.list()).toHaveLength(1);
      await store.delete("c1");
      expect(await store.get("c1")).toBeNull();
    });
  });

  describe("sessões e Administrator atômico", () => {
    async function seed(store: PostgresUserStore, admins: number) {
      await store.createRole({ id: "r1", name: "Op", permissions: [] });
      const ids: string[] = [];
      for (let i = 0; i < admins; i++) {
        const u = await store.createUser({ fullname: `Admin ${i}`, username: `admin${i}`, password: "Abcdef1!", roleId: "r1" });
        await store.setAdmin(u.id, true);
        ids.push(u.id);
      }
      return ids;
    }

    it("rebaixamentos concorrentes: exatamente um passa, sempre sobra um admin ativo", async () => {
      const store = new PostgresUserStore(db);
      const [a, b] = await seed(store, 2);
      const results = await Promise.allSettled([store.updateUser(a!, { isAdmin: false }), store.updateUser(b!, { isAdmin: false })]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(LastAdminError);
      const admins = (await store.listUsers()).filter((u) => u.isAdmin && u.status === "active");
      expect(admins).toHaveLength(1);
    });

    it("rebaixar e inativar/excluir concorrentes também não zeram os admins", async () => {
      const store = new PostgresUserStore(db);
      const [a, b, c] = await seed(store, 3);
      await Promise.allSettled([
        store.updateUser(a!, { isAdmin: false }),
        store.updateUser(b!, { status: "inactive" }),
        store.deleteUser(c!),
      ]);
      const admins = (await store.listUsers()).filter((u) => u.isAdmin && u.status === "active");
      expect(admins).toHaveLength(1);
    });

    it("promoção concorrente com rebaixamento do único admin não se perde", async () => {
      const store = new PostgresUserStore(db);
      const [a] = await seed(store, 1);
      const p = await store.createUser({ fullname: "Promovido", username: "promovido", password: "Abcdef1!", roleId: "r1" });
      const results = await Promise.allSettled([store.updateUser(p.id, { isAdmin: true }), store.updateUser(a!, { isAdmin: false })]);
      const admins = (await store.listUsers()).filter((u) => u.isAdmin && u.status === "active");
      expect(admins.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    });

    it("bump de sessionVersion em reset, logout, troca de role e inativação; não em edição simples", async () => {
      const store = new PostgresUserStore(db);
      await store.createRole({ id: "r1", name: "Op", permissions: [] });
      await store.createRole({ id: "r2", name: "Op2", permissions: [] });
      const u = await store.createUser({ fullname: "Ana", username: "ana", password: "Abcdef1!", roleId: "r1" });
      const version = async () => (await store.findById(u.id))?.sessionVersion;
      expect(await version()).toBe(0);
      await store.updateUser(u.id, { fullname: "Ana B" });
      expect(await version()).toBe(0);
      await store.updateUser(u.id, { roleId: "r2" });
      expect(await version()).toBe(1);
      await store.updateUser(u.id, { status: "inactive" });
      expect(await version()).toBe(2);
      await store.resetPassword(u.id, PasswordService.hash("Abcdef1!"));
      expect(await version()).toBe(3);
      await store.revokeSessions(u.id);
      expect(await version()).toBe(4);
    });
  });

  describe("Closing Periods", () => {
    it("salva (upsert), lista e lê", async () => {
      const store = new PostgresClosingPeriodStore(db);
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
      expect(await store.get("w1")).toEqual({ ...ws, status: "closed" });
      expect(await store.get("nada")).toBeNull();
    });

    it("remove a linha e libera o id", async () => {
      const store = new PostgresClosingPeriodStore(db);
      const now = "2026-10-01T00:00:00.000Z";
      await store.save({ id: "w2", name: "x", startDate: "2026-11-01", endDate: "2026-11-30", status: "open", createdAt: now, updatedAt: now });
      await store.delete("w2");
      expect(await store.get("w2")).toBeNull();
    });
  });
});
