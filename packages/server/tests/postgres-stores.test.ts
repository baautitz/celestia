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
import { LastAdminError } from "../src/iam/user-store.js";
import { PasswordService } from "../src/iam/password-service.js";
import { PostgresErpStore } from "../src/erp/postgres-erp-store.js";
import { PostgresPreVencidoStore } from "../../../integrations/inovafarma/src/postgres-pre-vencido-store.js";
import { PostgresAvaliacaoStore } from "../../../integrations/inovafarma/src/postgres-avaliacao-store.js";
import { PostgresFuroEstoqueStore } from "../../../integrations/inovafarma/src/postgres-furo-estoque-store.js";
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
        { moduleId: "inovafarma", schema: "inovafarma" },
      ]);
      // `audit` pode já ter sido aplicado por `audit-postgres.test.ts` quando vitest roda os arquivos em paralelo.
      for (const item of firstRun.filter((m) => m.moduleId !== "audit")) {
        // O iam tem a inicial, as de Dispositivos (criar, permissões do Gestor, remover o tipo e mover para a CA) e a que troca Excluir por Inativar Usuários; o erp tem a inicial e a que apaga a tabela legada; o audit tem a inicial e a do Dispositivo; o inovafarma tem a inicial, a das Lojas, a dos Lançamentos de Pré-vencidos, a das Avaliações, a do Furo de Estoque e as três das Metas (Tipos de Meta, Montar Metas e Apuração); os demais só a inicial.
        expect(item.applied).toHaveLength(item.moduleId === "iam" ? 6 : item.moduleId === "erp" || item.moduleId === "audit" ? 2 : item.moduleId === "inovafarma" ? 8 : 1);
        expect(item.applied[0]).toMatch(/^\d{14}_create_/);
      }

      const secondRun = await runModuleMigrations(db, plan);
      expect(secondRun).toEqual(plan.map((m) => ({ moduleId: m.moduleId, applied: [] })));

      const tables = await db.execute<{ schema: string; name: string }>(sql`
        SELECT table_schema AS schema, table_name AS name
        FROM information_schema.tables
        WHERE table_schema IN ('iam', 'audit', 'closing_period', 'erp', 'inovafarma')
        ORDER BY table_schema, table_name
      `);
      expect(tables.rows).toEqual([
        { schema: "audit", name: "audit_log_entries" },
        { schema: "closing_period", name: "periods" },
        { schema: "erp", name: "erps" },
        { schema: "iam", name: "roles" },
        { schema: "iam", name: "users" },
        { schema: "inovafarma", name: "avaliacoes" },
        { schema: "inovafarma", name: "justificativas_ajuste" },
        { schema: "inovafarma", name: "motivos_ajuste" },
        { schema: "inovafarma", name: "pre_vencidos_lancamentos" },
        { schema: "inovafarma", name: "vinculos_colaborador" },
      ]);
    });

    it("semeia os Roles iniciais gestor e operador e cria o primeiro Administrator na Role gestor", async () => {
      const store = new PostgresUserStore(db);
      const roles = await store.listRoles();
      // A ordem das chaves não importa: migrations posteriores acrescentam permissões ao fim da lista.
      const sortKeys = (list: readonly { permissions: string[] }[]) => list.map((r) => ({ ...r, permissions: [...r.permissions].sort() }));
      expect(sortKeys(roles)).toEqual(sortKeys([...INITIAL_ROLES].sort((a, b) => a.name.localeCompare(b.name))));
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
      await db.execute(sql`TRUNCATE iam.users, iam.roles, erp.erps, closing_period.periods, inovafarma.pre_vencidos_lancamentos, inovafarma.avaliacoes, inovafarma.justificativas_ajuste CASCADE`);
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

    describe("Lançamentos de Pré-vencidos", () => {
      const novo = {
        periodoId: "p1",
        codigoColaborador: 7,
        nomeColaborador: "ANA",
        usuarioId: "ana",
        codigoLoja: 1,
        produtoId: "guid-1",
        codigoProduto: 987654,
        nomeProduto: "DIPIRONA 500MG",
        codigoBarra: "7891234567895",
        quantidade: 3,
        validade: "2027-06",
      };

      it("cria, lista pelo período e Colaborador, edita e exclui com a version", async () => {
        const store = new PostgresPreVencidoStore(db);
        const criado = await store.criar(novo);
        await store.criar({ ...novo, codigoColaborador: 8 });
        expect(criado).toMatchObject({ version: 1, quantidade: 3, codigoProduto: 987654 });
        expect(await store.listar({ periodoId: "p1", codigoColaborador: 7 })).toHaveLength(1);
        expect(await store.listar({ periodoId: "p1" })).toHaveLength(2);
        expect(await store.listar({ periodoId: "outro" })).toHaveLength(0);

        expect(await store.atualizar(criado.id, { quantidade: 9, validade: "2027-08" }, 99)).toBeNull();
        expect(await store.atualizar(criado.id, { quantidade: 9, validade: "2027-08" }, 1)).toMatchObject({ quantidade: 9, validade: "2027-08", version: 2 });
        expect(await store.excluir(criado.id, 1)).toBe(false);
        expect(await store.excluir(criado.id, 2)).toBe(true);
        expect(await store.get(criado.id)).toBeNull();
      });
    });

    describe("Avaliações do Colaborador", () => {
      const nova = { periodoId: "p1", codigoColaborador: 7, nomeColaborador: "ANA", codigoLoja: 1, descricao: "Atraso", valorCentavos: 1250, criadoPor: "gil" };

      it("cria, lista pelo período e pelas Lojas, edita e exclui com a version", async () => {
        const store = new PostgresAvaliacaoStore(db);
        const criada = await store.criar(nova);
        await store.criar({ ...nova, codigoLoja: 2, valorCentavos: 0 });
        expect(criada).toMatchObject({ version: 1, valorCentavos: 1250 });
        expect(await store.listar({ periodoId: "p1", lojas: [1] })).toHaveLength(1);
        expect(await store.listar({ periodoId: "p1", lojas: [] })).toHaveLength(0);
        expect(await store.listar({ periodoId: "p1" })).toHaveLength(2);
        expect(await store.listar({ periodoId: "p1", codigoColaborador: 8 })).toHaveLength(0);

        expect(await store.atualizar(criada.id, { descricao: "Falta", valorCentavos: 0 }, 99)).toBeNull();
        expect(await store.atualizar(criada.id, { descricao: "Falta", valorCentavos: 0 }, 1)).toMatchObject({ descricao: "Falta", valorCentavos: 0, version: 2 });
        expect(await store.excluir(criada.id, 1)).toBe(false);
        expect(await store.excluir(criada.id, 2)).toBe(true);
        expect(await store.get(criada.id)).toBeNull();
      });
    });

    describe("Furo de Estoque", () => {
      it("semeia os Motivos, aceita uma Justificativa por Ajuste e edita e exclui com a version", async () => {
        const store = new PostgresFuroEstoqueStore(db);
        const motivos = await store.listarMotivos();
        expect(motivos.map((m) => m.nome)).toContain("Vencido");
        await expect(store.criarMotivo("vencido")).rejects.toThrow();

        const nova = { periodoId: "p1", codigoMovimento: 100, codigoLoja: 1, motivoId: "mot_vencido", observacao: null, criadoPor: "gil" };
        const criada = await store.justificar(nova);
        expect(criada).toMatchObject({ version: 1, codigoMovimento: 100 });
        expect(await store.justificar(nova)).toBeNull();
        expect(await store.listarJustificativas("p1")).toHaveLength(1);

        expect(await store.atualizarJustificativa(criada!.id, { motivoId: "mot_troca", observacao: "x" }, 99)).toBeNull();
        expect(await store.atualizarJustificativa(criada!.id, { motivoId: "mot_troca", observacao: "x" }, 1)).toMatchObject({ motivoId: "mot_troca", version: 2 });
        expect(await store.excluirJustificativa(criada!.id, 1)).toBe(false);
        expect(await store.excluirJustificativa(criada!.id, 2)).toBe(true);
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
