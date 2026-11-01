import { TestUserStore } from "./helpers/fixtures.js";
import { describe, it, expect } from "vitest";
import { createPlatform } from "../src/index.js";
import { integrationPlugins, integrationErpDrivers } from "../src/plugins.js";
import { PasswordService } from "../src/iam/password-service.js";
import type { ErpClient, ErpClientRegistry } from "../src/erp/erp-client.js";

/** O mock não conhece o TRow pedido pelo chamador; o cast fica confinado aqui. */
function mockErpClient(
  handler: (sql: string, params?: Record<string, unknown>) => unknown[] | Promise<unknown[]>
): ErpClient {
  return { query: async <TRow>(sql: string, params?: Record<string, unknown>) => (await handler(sql, params)) as TRow[] };
}

async function boot(
  permissions: string[],
  erpClients: ErpClientRegistry = {}
) {
  const userStore = new TestUserStore({
    roles: [{ id: "r", name: "R", permissions }],
    users: [
      {
        id: "u",
        username: "ana",
        fullname: "Ana",
        passwordHash: PasswordService.hash("Senha@123"),
        roleId: "r",
        status: "active",
        createdAt: new Date().toISOString(),
      },
    ],
  });
  const platform = createPlatform({ userStore, erpClients });
  await platform.start();
  const login = await platform.app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ana", password: "Senha@123" }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  return { platform, headers: { authorization: `Bearer ${accessToken}` } };
}

describe("Plugin InovaFarma (/integrations/inovafarma)", () => {
  it("está na lista estática de Modules como Plugin", () => {
    const entries = integrationPlugins({ auth: async (_c, next) => next() });
    expect(entries.some((e) => e.tier === "plugin" && e.def.id === "inovafarma")).toBe(true);
  });

  it("exporta o driver InovaFarma com os campos de conexão", () => {
    const drivers = integrationErpDrivers();
    expect(drivers.inovafarma).toBeDefined();
    expect(drivers.inovafarma.label).toBe("InovaFarma");
    expect(drivers.inovafarma).not.toHaveProperty("externalFields");
  });

  it("serve a rota /status com a Permission e nega sem ela", async () => {
    const allowed = await boot(["inovafarma:integration:view"]);
    const ok = await allowed.platform.app.request("/api/m/inovafarma/status", { headers: allowed.headers });
    expect(ok.status).toBe(200);
    const status = await ok.json();
    expect(status).toMatchObject({ module: "inovafarma", erpId: "inovafarma" });
    expect(status).not.toHaveProperty("externals");

    const denied = await boot([]);
    expect((await denied.platform.app.request("/api/m/inovafarma/status", { headers: denied.headers })).status).toBe(403);
    expect((await denied.platform.app.request("/api/m/inovafarma/status")).status).toBe(401);
  });

  describe("GET /colaboradores", () => {
    const view = "inovafarma:colaboradores:view";

    it("lista todo Funcionario com Cadastro não eliminado, com Cód., nome e situação no ERP", async () => {
      let consulta = "";
      const client = mockErpClient(async (sql) => {
        consulta = sql;
        return [
          { codigoColaborador: 7, nome: " ANA SOUZA ", ativo: true },
          { codigoColaborador: 9, nome: "BRUNO LIMA", ativo: false },
        ];
      });
      const { platform, headers } = await boot([view], { inovafarma: client });
      const res = await platform.app.request("/api/m/inovafarma/colaboradores", { headers });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        colaboradores: [
          { codigoColaborador: 7, nome: "ANA SOUZA", ativo: true },
          { codigoColaborador: 9, nome: "BRUNO LIMA", ativo: false },
        ],
      });
      expect(consulta).toContain("FROM Funcionario");
      expect(consulta).toContain("c.Eliminado = 0");
      expect(consulta).not.toContain("DataDesligamento");
      expect(consulta).not.toMatch(/WHERE[^]*Ativo/);
    });

    it("nega sem a Permission com a mensagem em PT-BR, mesmo com a Permission do relatório", async () => {
      const { platform, headers } = await boot(["inovafarma:integration:view"]);
      const res = await platform.app.request("/api/m/inovafarma/colaboradores", { headers });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "Acesso negado: o usuário não possui permissão para visualizar os Colaboradores do InovaFarma.",
      });
      expect((await platform.app.request("/api/m/inovafarma/colaboradores")).status).toBe(401);
    });

    it("responde 503 sem conexão com o ERP", async () => {
      const { platform, headers } = await boot([view]);
      const res = await platform.app.request("/api/m/inovafarma/colaboradores", { headers });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "Conexão com ERP InovaFarma não configurada ou inativa." });
    });

    it("responde 503 quando a consulta ao ERP falha, sem expor o erro do banco", async () => {
      const client = mockErpClient(async () => {
        throw new Error("login failed for user sa");
      });
      const { platform, headers } = await boot([view], { inovafarma: client });
      const res = await platform.app.request("/api/m/inovafarma/colaboradores", { headers });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "ERP InovaFarma indisponível. Tente novamente em instantes." });
    });

    it("não muda a rota /lojas: falha no ERP continua respondendo lista vazia", async () => {
      const client = mockErpClient(async () => {
        throw new Error("fora do ar");
      });
      const { platform, headers } = await boot(["inovafarma:integration:view"], { inovafarma: client });
      const res = await platform.app.request("/api/m/inovafarma/lojas", { headers });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });

  it("lista lojas através da tabela Config", async () => {
    const mockClient = mockErpClient(async (sql: string) => {
        if (sql.includes("Config")) {
          return [
            { codigoEmpresa: 1, nome: "Loja Centro" },
            { codigoEmpresa: 2, nome: "Loja Bairro" },
          ];
        }
        return [];
    });
    const { platform, headers } = await boot(["inovafarma:integration:view"], { inovafarma: mockClient });
    const res = await platform.app.request("/api/m/inovafarma/lojas", { headers });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([
      { codigoEmpresa: 1, nome: "Loja Centro" },
      { codigoEmpresa: 2, nome: "Loja Bairro" },
    ]);
  });

  it("calcula relatório de vendas por colaborador do item, com CMV", async () => {
    const mockClient = mockErpClient(async (sql: string, params?: Record<string, unknown>) => {
        expect(params).toMatchObject({
          dataInicio: "2026-10-01 00:00:00",
          dataFim: "2026-10-31 23:59:59",
        });
        // Como o relatório oficial: só vendas com caixa aberto, e reembolso de PBM com financeiro no líquido.
        expect(sql).toContain("v.CodigoAbertura IS NOT NULL");
        expect(sql).toContain("vpb.TemFinanceiro = 1");
      expect(sql).toContain("ISNULL(p.CodigoGrupoInventario, 0) <> 3");
        if (sql.includes("totalVendasGeral")) return [{ totalVendasGeral: 140, totalVendasComCadastro: 70 }];
        expect(sql).toContain("SUM(vp.Total + ISNULL(pbm.DescontoUnitarioPBM * vp.Quantidade, 0)) AS float) AS totalLiquido");
        return [
          {
            codigoColaborador: 10,
            nomeColaborador: "MARCOS SILVA",
            quantidadeVendas: 100,
            totalBruto: 12000,
            totalDesconto: 2000,
            totalLiquido: 10000,
            totalCmv: 6500,
            vendasComCadastro: 40,
          },
          {
            codigoColaborador: 20,
            nomeColaborador: "ANA SOUZA",
            quantidadeVendas: 50,
            totalBruto: 6000,
            totalDesconto: 1000,
            totalLiquido: 5000,
            totalCmv: 3500,
            vendasComCadastro: 10,
          },
        ];
    });
    const { platform, headers } = await boot(["inovafarma:integration:view"], { inovafarma: mockClient });
    const res = await platform.app.request(
      "/api/m/inovafarma/relatorios/vendas-colaborador?dataInicio=2026-10-01&dataFim=2026-10-31",
      { headers }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resumo: Record<string, unknown>;
      colaboradores: Record<string, unknown>[];
    };
    expect(body.resumo).toEqual({
      totalVendasGeral: 140,
      totalLiquidoGeral: 15000,
      totalBrutoGeral: 18000,
      totalDescontoGeral: 3000,
      totalCmvGeral: 10000,
      cmvPercentGeral: (10000 / 15000) * 100,
      cadastroPercentGeral: 50,
      totalColaboradores: 2,
      categorias: expect.any(Object),
    });
    expect(body.colaboradores[0]).toEqual({
      codigoColaborador: 10,
      nomeColaborador: "MARCOS SILVA",
      quantidadeVendas: 100,
      totalBruto: 12000,
      totalDesconto: 2000,
      totalLiquido: 10000,
      totalCmv: 6500,
      cmvPercent: 65,
      ticketMedio: 100,
      participacaoPercent: (10000 / 15000) * 100,
      cadastroPercent: 40,
      categorias: expect.any(Object),
    });
  });

  it("soma Qtde e Valor de Vitaminas, Genéricos, Similares, Incentivos e Total Foco por colaborador e no resumo", async () => {
    const mockClient = mockErpClient(async (sql: string) => {
        if (sql.includes("totalVendasGeral")) return [{ totalVendasGeral: 3, totalVendasComCadastro: 0 }];
        for (const filtro of ["p.CodigoGrupo = 44", "p.CodigoSessao = 261", "p.CodigoSessao = 271", "p.CodigoSessao = 281"]) {
          expect(sql).toContain(`CASE WHEN ${filtro} THEN vp.Quantidade END`);
          expect(sql).toContain(`CASE WHEN ${filtro} THEN vp.Total END`);
        }
        // Total Foco: um item conta uma vez, mesmo sendo Vitamina e também de uma seção.
        const foco = "(p.CodigoGrupo = 44 OR p.CodigoSessao = 261 OR p.CodigoSessao = 271 OR p.CodigoSessao = 281)";
        expect(sql).toContain(`CASE WHEN ${foco} THEN vp.Quantidade END`);
        expect(sql).toContain(`CASE WHEN ${foco} THEN vp.Total END`);
        return [
          {
            codigoColaborador: 10,
            nomeColaborador: "MARCOS SILVA",
            quantidadeVendas: 2,
            totalBruto: 500,
            totalDesconto: 0,
            totalLiquido: 500,
            totalCmv: 0,
            vendasComCadastro: 0,
            qtdVitaminas: 3,
            valorVitaminas: 90.5,
            qtdGenericos: 10,
            valorGenericos: 200,
            qtdSimilares: 0,
            valorSimilares: 0,
            qtdIncentivos: 1,
            valorIncentivos: 35,
            qtdTotalFoco: 13,
            valorTotalFoco: 290.5,
          },
          {
            codigoColaborador: 20,
            nomeColaborador: "ANA SOUZA",
            quantidadeVendas: 1,
            totalBruto: 100,
            totalDesconto: 0,
            totalLiquido: 100,
            totalCmv: 0,
            vendasComCadastro: 0,
            qtdVitaminas: null,
            valorVitaminas: null,
            qtdGenericos: 2,
            valorGenericos: 40,
            qtdSimilares: 4,
            valorSimilares: 60,
            qtdIncentivos: null,
            valorIncentivos: null,
            qtdTotalFoco: 6,
            valorTotalFoco: 100,
          },
        ];
    });
    const { platform, headers } = await boot(["inovafarma:integration:view"], { inovafarma: mockClient });
    const res = await platform.app.request(
      "/api/m/inovafarma/relatorios/vendas-colaborador?dataInicio=2026-10-01&dataFim=2026-10-31",
      { headers }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resumo: { categorias: unknown };
      colaboradores: { categorias: unknown }[];
    };
    expect(body.colaboradores.map((c) => c.categorias)).toEqual([
      {
        vitaminas: { quantidade: 3, valor: 90.5 },
        genericos: { quantidade: 10, valor: 200 },
        similares: { quantidade: 0, valor: 0 },
        incentivos: { quantidade: 1, valor: 35 },
        totalFoco: { quantidade: 13, valor: 290.5 },
      },
      {
        vitaminas: { quantidade: 0, valor: 0 },
        genericos: { quantidade: 2, valor: 40 },
        similares: { quantidade: 4, valor: 60 },
        incentivos: { quantidade: 0, valor: 0 },
        totalFoco: { quantidade: 6, valor: 100 },
      },
    ]);
    expect(body.resumo.categorias).toEqual({
      vitaminas: { quantidade: 3, valor: 90.5 },
      genericos: { quantidade: 12, valor: 240 },
      similares: { quantidade: 4, valor: 60 },
      incentivos: { quantidade: 1, valor: 35 },
      totalFoco: { quantidade: 19, valor: 390.5 },
    });
  });
});
