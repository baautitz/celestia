import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { assertMigrationsUpToDate, runModuleMigrations, type MigrationResult } from "@platform/core/migrations";
import { migrationPlan } from "../src/boot/compose.js";
import { upsertAdminUser } from "../src/cli/create-admin.js";
import { createPlatform } from "../src/index.js";
import { DEFAULT_ADMIN_ROLE_ID, INITIAL_ROLES } from "../src/iam/initial-roles.js";
import { PostgresUserStore } from "../src/iam/postgres-user-store.js";
import { PostgresDeviceStore } from "../src/iam/postgres-device-store.js";
import { DeviceNotFoundError, DuplicateDeviceFingerprintError } from "../src/iam/device-store.js";
import { LastAdminError } from "../src/iam/user-store.js";
import { PasswordService } from "../src/iam/password-service.js";
import { PostgresErpStore } from "../src/erp/postgres-erp-store.js";
import { PostgresErpExternalsStore } from "../src/erp/postgres-erp-externals-store.js";
import { PostgresClosingPeriodStore } from "../src/closing-period/postgres-closing-period-store.js";
import { createTestPool, dbTestsEnabled } from "./helpers/test-db.js";

const plan = migrationPlan(createPlatform().modules);

describe.skipIf(!dbTestsEnabled)("stores contra Postgres real", () => {
  // Criados no beforeAll: o corpo do describe roda mesmo quando a suíte é ignorada.
  let pool: Pool;
  let db: NodePgDatabase;
  let firstRun: MigrationResult[];

  beforeAll(async () => {
    pool = createTestPool();
    db = drizzle({ client: pool });
    firstRun = await runModuleMigrations(db, plan);
    await assertMigrationsUpToDate(db, plan);
  });
  afterAll(async () => {
    await pool?.end();
  });

  describe("migrations por Module, Roles iniciais e primeiro Administrator", () => {
    it("aplica todas pelo plano, cria um schema por Module e rodar de novo não faz nada", async () => {
      expect(plan.map((m) => ({ moduleId: m.moduleId, schema: m.schema }))).toEqual([
        { moduleId: "iam", schema: "iam" },
        { moduleId: "audit", schema: "audit" },
        { moduleId: "closing_period", schema: "closing_period" },
        { moduleId: "erp", schema: "erp" },
      ]);
      // `audit` pode já ter sido aplicado por `audit-postgres.test.ts` quando vitest roda os arquivos em paralelo.
      for (const item of firstRun.filter((m) => m.moduleId !== "audit")) {
        expect(item.applied).toHaveLength(1);
        expect(item.applied[0]).toMatch(/^\d{14}_create_/);
      }

      const secondRun = await runModuleMigrations(db, plan);
      expect(secondRun).toEqual(plan.map((m) => ({ moduleId: m.moduleId, applied: [] })));

      const tables = await db.execute<{ schema: string; name: string }>(sql`
        SELECT table_schema AS schema, table_name AS name
        FROM information_schema.tables
        WHERE table_schema IN ('iam', 'audit', 'closing_period', 'erp')
        ORDER BY table_schema, table_name
      `);
      expect(tables.rows).toEqual([
        { schema: "audit", name: "audit_log_entries" },
        { schema: "closing_period", name: "periods" },
        { schema: "erp", name: "erps" },
        { schema: "erp", name: "user_externals" },
        { schema: "iam", name: "devices" },
        { schema: "iam", name: "roles" },
        { schema: "iam", name: "users" },
      ]);
    });

    it("semeia os Roles iniciais gestor e operador e cria o primeiro Administrator na Role gestor", async () => {
      const store = new PostgresUserStore(db);
      const roles = await store.listRoles();
      expect(roles).toEqual([...INITIAL_ROLES].sort((a, b) => a.name.localeCompare(b.name)));
      expect(roles.find((r) => r.id === "role_admin")).toBeUndefined();
      expect(INITIAL_ROLES.flatMap((r) => r.permissions)).not.toContain("system:roles:delete");
      expect(roles.flatMap((r) => r.permissions)).not.toContain("system:roles:delete");

      const created = await upsertAdminUser(store, {
        username: "primeiro.admin",
        fullname: "Primeiro Admin",
        email: "admin@celestia.local",
        password: "Abcdef1!",
      });
      expect(created.created).toBe(true);
      const admin = await store.findById(created.id);
      expect(admin).toMatchObject({
        username: "primeiro.admin",
        roleId: DEFAULT_ADMIN_ROLE_ID,
        isAdmin: true,
        status: "active",
      });

      await expect(
        upsertAdminUser(store, {
          username: "primeiro.admin",
          fullname: "Outro Nome",
          password: "Abcdef1!",
        }),
      ).rejects.toThrow(/--force/);

      const updated = await upsertAdminUser(store, {
        username: "primeiro.admin",
        fullname: "Primeiro Admin Atualizado",
        password: "Abcdef2!",
        force: true,
      });
      expect(updated).toEqual({ id: created.id, username: "primeiro.admin", created: false });
      expect((await store.findById(created.id))?.fullname).toBe("Primeiro Admin Atualizado");
    });
  });

  describe("operações das stores (com banco limpo a cada teste)", () => {
    beforeEach(async () => {
      await db.execute(sql`TRUNCATE iam.users, iam.roles, iam.devices, erp.erps, closing_period.periods CASCADE`);
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
      it("a opção de acesso sem certificado nasce desligada, persiste e encerra as sessões ao mudar", async () => {
        const store = new PostgresUserStore(db);
        await store.createRole({ id: "r1", name: "Op", permissions: [] });
        const comum = await store.createUser({ fullname: "Ana", username: "ana", password: "Abcdef1!", roleId: "r1" });
        const isento = await store.createUser({ fullname: "Bia", username: "bia", password: "Abcdef1!", roleId: "r1", allowWithoutCertificate: true });
        expect(comum.allowWithoutCertificate).toBe(false);
        expect(isento.allowWithoutCertificate).toBe(true);

        const before = (await store.findById(isento.id))?.sessionVersion;
        await store.updateUser(isento.id, { allowWithoutCertificate: false });
        const after = await store.findById(isento.id);
        expect(after?.allowWithoutCertificate).toBe(false);
        expect(after?.sessionVersion).toBe((before ?? 0) + 1);

        await store.updateUser(isento.id, { allowWithoutCertificate: false });
        expect((await store.findById(isento.id))?.sessionVersion).toBe((before ?? 0) + 1);
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

    describe("Dispositivos", () => {
      const input = (n: number) => ({
        name: `Caixa ${n}`,
        type: "computer" as const,
        fingerprint: n.toString(16).padStart(64, "0"),
        serial: `0${n}`,
        notAfter: "2036-01-01T00:00:00.000Z",
      });
      it("registra, encontra só o ativo e revoga de forma definitiva e idempotente", async () => {
        const store = new PostgresDeviceStore(db);
        const device = await store.create(input(1));
        expect(await store.findActiveByFingerprint(input(1).fingerprint)).toEqual(device);

        const revoked = await store.revoke(device.id, "admin-1");
        expect(revoked).toMatchObject({ status: "revoked", revokedBy: "admin-1" });
        expect(await store.findActiveByFingerprint(input(1).fingerprint)).toBeNull();
        expect(await store.revoke(device.id, "admin-2")).toEqual(revoked);
        expect(await store.list()).toEqual([revoked]);
      });
      it("recusa fingerprint duplicado e revogação de Dispositivo inexistente", async () => {
        const store = new PostgresDeviceStore(db);
        await store.create(input(1));
        await expect(store.create({ ...input(2), fingerprint: input(1).fingerprint })).rejects.toBeInstanceOf(
          DuplicateDeviceFingerprintError,
        );
        await expect(store.revoke("nao-existe")).rejects.toBeInstanceOf(DeviceNotFoundError);
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

    describe("Externals", () => {
      it("grava por usuário e ERP e some junto com o ERP", async () => {
        const erps = new PostgresErpStore(db);
        const store = new PostgresErpExternalsStore(db);
        await erps.save({ id: "ex1", name: "ERP", driver: "mssql", config: {}, secretsEncrypted: "" });
        await store.save("usr_a", "ex1", { userId: "7" });
        await store.save("usr_a", "ex1", { userId: "8", company: "Matriz" });
        expect(await store.get("usr_a", "ex1")).toEqual({ userId: "8", company: "Matriz" });
        expect(await store.get("usr_b", "ex1")).toEqual({});
        await erps.delete("ex1");
        expect(await store.get("usr_a", "ex1")).toEqual({});
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
          version: 1,
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

      it("updateIfCurrent só grava com a versão esperada e período aberto", async () => {
        const store = new PostgresClosingPeriodStore(db);
        const base = {
          id: "w2", name: "Ago", startDate: "2026-08-01", endDate: "2026-08-30", status: "open" as const, version: 1,
          createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
        };
        await store.save(base);
        const next = { ...base, endDate: "2026-08-31", version: 2 };
        expect(await store.updateIfCurrent(next, 1)).toBe(true);
        expect(await store.updateIfCurrent({ ...base, endDate: "2026-08-15", version: 2 }, 1)).toBe(false);
        expect((await store.get("w2"))?.endDate).toBe("2026-08-31");
        await store.save({ ...next, status: "closed" });
        expect(await store.updateIfCurrent({ ...next, version: 3 }, 2)).toBe(false);
      });

      it("transitionIfCurrent só grava com a versão e a situação esperadas", async () => {
        const store = new PostgresClosingPeriodStore(db);
        const base = {
          id: "w3", name: "Set", startDate: "2026-09-01", endDate: "2026-09-30", status: "open" as const, version: 1,
          createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
        };
        await store.save(base);
        expect(await store.transitionIfCurrent({ ...base, status: "closed", version: 2 }, 5, "open")).toBe(false);
        expect(await store.transitionIfCurrent({ ...base, status: "closed", version: 2 }, 1, "closed")).toBe(false);
        expect(await store.transitionIfCurrent({ ...base, status: "closed", version: 2 }, 1, "open")).toBe(true);
        expect((await store.get("w3"))?.status).toBe("closed");
      });
    });
  });
});
