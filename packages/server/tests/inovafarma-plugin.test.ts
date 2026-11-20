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
    expect(drivers.inovafarma.label).toBe("InovaFarma");
    expect(drivers.inovafarma).not.toHaveProperty("externalFields");
  });

  describe("GET /colaboradores", () => {
    const view = "inovafarma:colaboradores:view";

    it("lista todo Funcionario com Cadastro não eliminado, com Cód., nome e situação no ERP", async () => {
      let consulta = "";
      const client = mockErpClient(async (sql) => {
        if (sql.includes("Config")) return [];
        consulta = sql;
        return [
          { codigoColaborador: 7, nome: " ANA SOUZA ", ativo: true },
          { codigoColaborador: 9, nome: "BRUNO LIMA", ativo: false },
        ];
      });
      const { platform, headers } = await boot([view], { inovafarma: client });
      const res = await platform.app.request("/api/m/inovafarma/colaboradores", { headers });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        colaboradores: [
          { codigoColaborador: 7, nome: "ANA SOUZA", ativo: true },
          { codigoColaborador: 9, nome: "BRUNO LIMA", ativo: false },
        ],
      });
      expect(consulta).toContain("FROM Funcionario");
      expect(consulta).toContain("c.Eliminado = 0");
      expect(consulta).not.toContain("DataDesligamento");
      expect(consulta).not.toMatch(/WHERE[\s\S]*Ativo/);
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
    const { platform, headers } = await boot(["inovafarma:vendas-geral:view"], { inovafarma: mockClient });
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
      descontoPercentGeral: (3000 / 18000) * 100,
      totalCmvGeral: 10000,
      cmvPercentGeral: (10000 / 15000) * 100,
      cadastroPercentGeral: 50,
      totalColaboradores: 2,
      colunas: [],
    });
    expect(body.colaboradores[0]).toEqual({
      codigoColaborador: 10,
      nomeColaborador: "MARCOS SILVA",
      quantidadeVendas: 100,
      totalBruto: 12000,
      totalDesconto: 2000,
      descontoPercent: (2000 / 12000) * 100,
      totalLiquido: 10000,
      totalCmv: 6500,
      cmvPercent: 65,
      ticketMedio: 100,
      participacaoPercent: (10000 / 15000) * 100,
      cadastroPercent: 40,
      colunas: [],
    });
  });

  describe("Visualizações do Desempenho de Vendas", () => {
    const RELATORIO = "/api/m/inovafarma/relatorios/vendas-colaborador";
    const PERIODO = "dataInicio=2026-10-01&dataFim=2026-10-31";
    const sqls: { sql: string; params?: Record<string, unknown> }[] = [];
    const erp = mockErpClient(async (sql, params) => {
      if (sql.includes("FROM Funcionario")) return [{ codigoColaborador: 7, nome: "ANA", ativo: true }];
      if (sql.includes("Config")) return [{ codigoEmpresa: 1, nome: "Centro" }, { codigoEmpresa: 2, nome: "Bairro" }, { codigoEmpresa: 3, nome: "Norte" }];
      sqls.push({ sql, params });
      return sql.includes("totalVendasGeral") ? [{ totalVendasGeral: 0, totalVendasComCadastro: 0 }] : [];
    });

    /** Boot com o Usuário "u" vinculado ao Colaborador 7 nas Lojas 1 e 2 (ou sem vínculo). */
    async function bootVinculado(permissions: string[], vinculado = true) {
      const ctx = await boot([...permissions, "inovafarma:colaboradores:update"], { inovafarma: erp });
      if (vinculado) {
        const res = await ctx.platform.app.request("/api/m/inovafarma/colaboradores/7/vinculo", {
          method: "PUT",
          headers: { ...ctx.headers, "content-type": "application/json" },
          body: JSON.stringify({ usuarioId: "u", lojas: [1, 2], version: 0 }),
        });
        expect(res.status).toBe(200);
      }
      sqls.length = 0;
      return ctx;
    }

    it("lista as disponíveis em ordem Geral, Loja, Individual, com as Lojas que cada uma permite filtrar", async () => {
      const { platform, headers } = await bootVinculado([
        "inovafarma:vendas-individual:view",
        "inovafarma:vendas-geral:view",
        "inovafarma:vendas-loja:view",
      ]);
      const res = await platform.app.request(`${RELATORIO}/visualizacoes`, { headers });
      expect(await res.json()).toEqual({
        podeGerenciarColunas: false,
        periodos: [],
        visualizacoes: [
          { id: "geral", lojas: [{ codigoEmpresa: 1, nome: "Centro" }, { codigoEmpresa: 2, nome: "Bairro" }, { codigoEmpresa: 3, nome: "Norte" }] },
          { id: "loja", lojas: [{ codigoEmpresa: 1, nome: "Centro" }, { codigoEmpresa: 2, nome: "Bairro" }] },
          { id: "individual", lojas: [] },
        ],
      });
    });

    it("entrega os Períodos do serviço de Períodos, do mais recente ao mais antigo, sem exigir a Permission do Fechamento", async () => {
      const { platform, headers } = await bootVinculado(["inovafarma:vendas-geral:view", "closing_period:period:create"]);
      const criar = (name: string, startDate: string, endDate: string) =>
        platform.app.request("/api/closing-periods", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ name, startDate, endDate }) });
      expect((await criar("Setembro", "2026-09-01", "2026-09-30")).status).toBe(201);
      expect((await criar("Outubro", "2026-10-01", "2026-10-31")).status).toBe(201);
      const { platform: semFechamento, headers: semHeaders } = await bootVinculado(["inovafarma:vendas-geral:view"]);
      const sem = (await (await semFechamento.app.request(`${RELATORIO}/visualizacoes`, { headers: semHeaders })).json()) as { periodos: unknown[] };
      expect(sem.periodos).toEqual([]);
      const res = await platform.app.request(`${RELATORIO}/visualizacoes`, { headers });
      const body = (await res.json()) as { periodos: { name: string; status: string }[] };
      expect(body.periodos.map((p) => p.name)).toEqual(["Outubro", "Setembro"]);
      expect(body.periodos[0]).toMatchObject({ startDate: "2026-10-01", endDate: "2026-10-31", status: "open" });
    });

    it("Loja e Individual exigem vínculo; sem ele só resta o que a Permission liberar sem vínculo", async () => {
      const { platform, headers } = await bootVinculado(["inovafarma:vendas-loja:view", "inovafarma:vendas-individual:view"], false);
      expect(await (await platform.app.request(`${RELATORIO}/visualizacoes`, { headers })).json()).toEqual({ podeGerenciarColunas: false, periodos: [], visualizacoes: [] });
      const res = await platform.app.request(`${RELATORIO}?${PERIODO}`, { headers });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Seu perfil não possui nenhuma visualização disponível." });
      expect(sqls).toEqual([]);
    });

    it("nega uma Visualização que o Usuário não tem, sem cair para outra", async () => {
      const { platform, headers } = await bootVinculado(["inovafarma:vendas-individual:view"]);
      const res = await platform.app.request(`${RELATORIO}?${PERIODO}&visualizacao=geral`, { headers });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "Acesso negado: o usuário não possui permissão para a Visualização Geral do Desempenho de Vendas.",
      });
      expect((await platform.app.request(`${RELATORIO}?${PERIODO}&visualizacao=xyz`, { headers })).status).toBe(400);
    });

    it("Loja filtra pelas Lojas do vínculo, de qualquer vendedor, e recusa Loja fora do vínculo", async () => {
      const { platform, headers } = await bootVinculado(["inovafarma:vendas-loja:view"]);
      expect((await platform.app.request(`${RELATORIO}?${PERIODO}`, { headers })).status).toBe(200);
      expect(sqls[0]?.sql).toContain("v.CodigoEmpresa IN (@loja0, @loja1)");
      expect(sqls[0]?.sql).not.toContain("@codigoColaborador");
      expect(sqls[0]?.params).toMatchObject({ loja0: 1, loja1: 2 });

      sqls.length = 0;
      expect((await platform.app.request(`${RELATORIO}?${PERIODO}&codigoEmpresa=2`, { headers })).status).toBe(200);
      expect(sqls[0]?.params).toMatchObject({ loja0: 2 });

      sqls.length = 0;
      expect((await platform.app.request(`${RELATORIO}?${PERIODO}&codigoEmpresa=3`, { headers })).status).toBe(403);
      expect(sqls).toEqual([]);
    });

    it("Individual filtra pelo Colaborador vinculado, em qualquer Loja", async () => {
      const { platform, headers } = await bootVinculado(["inovafarma:vendas-individual:view"]);
      expect((await platform.app.request(`${RELATORIO}?${PERIODO}&codigoColaborador=99`, { headers })).status).toBe(200);
      expect(sqls[0]?.sql).toContain("vp.CodigoFuncionario = @codigoColaborador");
      expect(sqls[0]?.sql).not.toContain("CodigoEmpresa");
      expect(sqls[0]?.params).toMatchObject({ codigoColaborador: 7 });
    });

    it("Geral não filtra por vendedor nem por Loja, salvo a Loja pedida", async () => {
      const { platform, headers } = await bootVinculado(["inovafarma:vendas-geral:view"]);
      expect((await platform.app.request(`${RELATORIO}?${PERIODO}`, { headers })).status).toBe(200);
      expect(sqls[0]?.sql).not.toContain("@codigoColaborador");
      expect(sqls[0]?.sql).not.toContain("CodigoEmpresa = @");
    });
  });

  it("soma Qtde, Valor, CMV e Ticket de cada coluna por colaborador e no resumo, o Total Foco sem contar em dobro", async () => {
    const mockClient = mockErpClient(async (sql: string, params?: Record<string, unknown>) => {
      if (sql.includes("totalVendasGeral")) return [{ totalVendasGeral: 3, totalVendasComCadastro: 0 }];
      // Vitaminas (0), Genéricos (1), Similares (2), Incentivos (3) e Total Foco (4, a união das quatro, por OR).
      expect(params).toMatchObject({ col0_grupo0: 44, col1_secao0: 261, col2_secao0: 271, col3_secao0: 281 });
      expect(sql).toContain("CASE WHEN (p.CodigoGrupo IN (@col0_grupo0)) THEN vp.Quantidade END");
      expect(sql).toMatch(/CASE WHEN \(p\.CodigoGrupo IN \(@col4_grupo0\) OR p\.CodigoSessao IN \(@col4_secao0, @col4_secao1, @col4_secao2\)\) THEN vp\.Total END/);
      const linha = (n: number, v: number, cmv: number, vendas: number) => ({ [`colQtd${n}`]: v === 0 ? null : v, [`colValor${n}`]: v === 0 ? null : v * 10, [`colCmv${n}`]: cmv, [`colVendas${n}`]: vendas });
      return [
        {
          codigoColaborador: 10, nomeColaborador: "MARCOS SILVA", quantidadeVendas: 2, totalBruto: 500, totalDesconto: 0, totalLiquido: 500, totalCmv: 0, vendasComCadastro: 0,
          ...linha(0, 3, 15, 2), ...linha(1, 10, 50, 1), ...linha(2, 0, 0, 0), ...linha(3, 1, 5, 1), ...linha(4, 13, 70, 2),
        },
        {
          codigoColaborador: 20, nomeColaborador: "ANA SOUZA", quantidadeVendas: 1, totalBruto: 100, totalDesconto: 0, totalLiquido: 100, totalCmv: 0, vendasComCadastro: 0,
          ...linha(0, 0, 0, 0), ...linha(1, 2, 8, 1), ...linha(2, 4, 20, 1), ...linha(3, 0, 0, 0), ...linha(4, 6, 28, 1),
        },
      ];
    });
    const { platform, headers } = await boot(["inovafarma:vendas-geral:view", "inovafarma:colunas-desempenho:manage"], { inovafarma: mockClient });
    // O cliente monta as colunas: quatro por entrada e o Total Foco, a união das quatro.
    const criar = async (corpo: unknown) => (await platform.app.request("/api/m/inovafarma/colunas-desempenho", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(corpo) })).json() as Promise<{ id: string }>;
    const entradas = [
      ["Vitaminas", { tipo: "grupo", id: "44", nome: "VITAMINAS" }],
      ["Genéricos", { tipo: "secao", id: "261", nome: "GENERICOS" }],
      ["Similares", { tipo: "secao", id: "271", nome: "SIMILARES" }],
      ["Incentivos", { tipo: "secao", id: "281", nome: "INCENTIVOS" }],
    ] as const;
    const ids: string[] = [];
    for (const [nome, entrada] of entradas) ids.push((await criar({ nome, entradas: [entrada], uniao: [], medidas: ["quantidade", "valor", "participacaoPercent", "cmvPercent", "ticketMedio"] })).id);
    await criar({ nome: "Total Foco", entradas: [], uniao: ids, medidas: ["quantidade", "valor"] });
    const res = await platform.app.request("/api/m/inovafarma/relatorios/vendas-colaborador?dataInicio=2026-10-01&dataFim=2026-10-31", { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resumo: { colunas: { nome: string; quantidade: number; valor: number; cmvPercent: number }[] };
      colaboradores: { colunas: { nome: string; quantidade: number; valor: number; ticketMedio: number; participacaoPercent: number }[] }[];
    };
    expect(body.resumo.colunas.map((c) => c.nome)).toEqual(["Vitaminas", "Genéricos", "Similares", "Incentivos", "Total Foco"]);
    expect(body.colaboradores[0]?.colunas.map((c) => [c.quantidade, c.valor])).toEqual([[3, 30], [10, 100], [0, 0], [1, 10], [13, 130]]);
    expect(body.colaboradores[0]?.colunas[0]).toMatchObject({ ticketMedio: 15, participacaoPercent: 30 / 600 * 100 });
    expect(body.colaboradores[1]?.colunas.map((c) => [c.quantidade, c.valor])).toEqual([[0, 0], [2, 20], [4, 40], [0, 0], [6, 60]]);
    // O Total Foco do resumo é a soma por Colaborador do que cada um somou uma vez; as colunas somam aos poucos.
    expect(body.resumo.colunas.map((c) => [c.quantidade, c.valor])).toEqual([[3, 30], [12, 120], [4, 40], [1, 10], [19, 190]]);
    expect(body.resumo.colunas[0]?.cmvPercent).toBe(50);
  });

  describe("Validação e falhas do relatório de vendas", () => {
    const RELATORIO = "/api/m/inovafarma/relatorios/vendas-colaborador";
    const consultas: string[] = [];
    const ok = mockErpClient(async (sql) => {
      consultas.push(sql);
      return sql.includes("totalVendasGeral") ? [{ totalVendasGeral: 0, totalVendasComCadastro: 0 }] : [];
    });

    const recusa = (path: string, message: string) => ({ error: { issues: [{ path: [path], message }] } });
    const DATAS = "Parâmetros 'dataInicio' e 'dataFim' são obrigatórios no formato YYYY-MM-DD.";

    it("recusa data que não existe no calendário, com o corpo de validação da plataforma", async () => {
      consultas.length = 0;
      const { platform, headers } = await boot(["inovafarma:vendas-geral:view"], { inovafarma: ok });
      const res = await platform.app.request(`${RELATORIO}?dataInicio=2026-13-99&dataFim=2026-10-31`, { headers });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(recusa("dataInicio", DATAS));
      const fevereiro = await platform.app.request(`${RELATORIO}?dataInicio=2026-02-31&dataFim=2026-10-31`, { headers });
      expect(fevereiro.status).toBe(400);
      expect(consultas).toEqual([]);
    });

    it("recusa a data final antes da inicial", async () => {
      const { platform, headers } = await boot(["inovafarma:vendas-geral:view"], { inovafarma: ok });
      const res = await platform.app.request(`${RELATORIO}?dataInicio=2026-10-31&dataFim=2026-10-01`, { headers });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(recusa("dataFim", "A data final não pode ser anterior à data inicial."));
    });

    it("aceita o período de um só dia", async () => {
      const { platform, headers } = await boot(["inovafarma:vendas-geral:view"], { inovafarma: ok });
      expect((await platform.app.request(`${RELATORIO}?dataInicio=2026-10-05&dataFim=2026-10-05`, { headers })).status).toBe(200);
    });

    it("recusa a Loja que não é um código inteiro, em vez de ignorar o filtro", async () => {
      consultas.length = 0;
      const { platform, headers } = await boot(["inovafarma:vendas-geral:view"], { inovafarma: ok });
      for (const loja of ["abc", "1.5", "0", "-2"]) {
        const res = await platform.app.request(`${RELATORIO}?dataInicio=2026-10-01&dataFim=2026-10-31&codigoEmpresa=${loja}`, { headers });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(recusa("codigoEmpresa", "Informe um código inteiro maior que zero."));
      }
      expect(consultas).toEqual([]);
    });

    it("recusa a Visualização inexistente antes de olhar a Permission", async () => {
      const { platform, headers } = await boot([], { inovafarma: ok });
      const res = await platform.app.request(`${RELATORIO}?dataInicio=2026-10-01&dataFim=2026-10-31&visualizacao=xyz`, { headers });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(recusa("visualizacao", "Parâmetro 'visualizacao' deve ser geral, loja ou individual."));
    });

    it("responde 503 sem expor o erro do banco quando a consulta ao ERP falha", async () => {
      const quebrado = mockErpClient(async () => {
        throw new Error("Invalid column name 'SenhaDoBanco' on host erp.interno:1433");
      });
      const { platform, headers } = await boot(["inovafarma:vendas-geral:view"], { inovafarma: quebrado });
      const res = await platform.app.request(`${RELATORIO}?dataInicio=2026-10-01&dataFim=2026-10-31`, { headers });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "ERP InovaFarma indisponível. Tente novamente em instantes." });
    });
  });
});
