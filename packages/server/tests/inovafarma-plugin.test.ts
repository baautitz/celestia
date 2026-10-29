import { describe, it, expect } from "vitest";
import { createPlatform } from "../src/index.js";
import { integrationPlugins, integrationExternalFields, integrationErpDrivers } from "../src/plugins.js";
import { MemoryUserStore } from "../src/iam/user-store.js";
import { PasswordService } from "../src/iam/password-service.js";

async function boot(
  permissions: string[],
  erpClients: Record<string, { query: (sql: string, params?: Record<string, unknown>) => Promise<unknown[]> }> = {}
) {
  const userStore = new MemoryUserStore({
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

  it("declara externals para o ERP inovafarma", () => {
    const fields = integrationExternalFields();
    expect(fields.inovafarma).toBeDefined();
    expect(fields.inovafarma!.map((f) => f.name)).toEqual(["codigoColaborador", "codigoLoja"]);
  });

  it("exporta o driver InovaFarma com os campos de conexão e externals", () => {
    const drivers = integrationErpDrivers();
    expect(drivers.inovafarma).toBeDefined();
    expect(drivers.inovafarma.label).toBe("InovaFarma");
    expect(drivers.inovafarma.externalFields.map((f) => f.name)).toEqual(["codigoColaborador", "codigoLoja"]);
  });

  it("serve a rota /status com a Permission e nega sem ela", async () => {
    const allowed = await boot(["inovafarma:integration:view"]);
    const ok = await allowed.platform.app.request("/api/m/inovafarma/status", { headers: allowed.headers });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      module: "inovafarma",
      erpId: "inovafarma",
      externals: expect.arrayContaining([
        expect.objectContaining({ name: "codigoColaborador" }),
        expect.objectContaining({ name: "codigoLoja" }),
      ]),
    });

    const denied = await boot([]);
    expect((await denied.platform.app.request("/api/m/inovafarma/status", { headers: denied.headers })).status).toBe(403);
    expect((await denied.platform.app.request("/api/m/inovafarma/status")).status).toBe(401);
  });

  it("lista lojas através da tabela Config", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql.includes("Config")) {
          return [
            { codigoEmpresa: 1, nome: "Loja Centro" },
            { codigoEmpresa: 2, nome: "Loja Bairro" },
          ];
        }
        return [];
      },
    };
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
    const mockClient = {
      query: async (sql: string, params?: Record<string, unknown>) => {
        expect(params).toMatchObject({
          dataInicio: "2026-10-01 00:00:00",
          dataFim: "2026-10-31 23:59:59",
        });
        if (sql.includes("totalVendasGeral")) return [{ totalVendasGeral: 140, totalVendasComCadastro: 70 }];
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
      },
    };
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

  it("soma Qtde e Valor de Vitaminas, Genéricos, Similares e Incentivos por colaborador e no resumo", async () => {
    const mockClient = {
      query: async (sql: string) => {
        if (sql.includes("totalVendasGeral")) return [{ totalVendasGeral: 3, totalVendasComCadastro: 0 }];
        for (const filtro of ["p.CodigoGrupo = 44", "p.CodigoSessao = 261", "p.CodigoSessao = 271", "p.CodigoSessao = 281"]) {
          expect(sql).toContain(`CASE WHEN ${filtro} THEN vp.Quantidade END`);
          expect(sql).toContain(`CASE WHEN ${filtro} THEN vp.Total END`);
        }
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
          },
        ];
      },
    };
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
      },
      {
        vitaminas: { quantidade: 0, valor: 0 },
        genericos: { quantidade: 2, valor: 40 },
        similares: { quantidade: 4, valor: 60 },
        incentivos: { quantidade: 0, valor: 0 },
      },
    ]);
    expect(body.resumo.categorias).toEqual({
      vitaminas: { quantidade: 3, valor: 90.5 },
      genericos: { quantidade: 12, valor: 240 },
      similares: { quantidade: 4, valor: 60 },
      incentivos: { quantidade: 1, valor: 35 },
    });
  });
});
