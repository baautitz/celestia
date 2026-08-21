import { describe, it, expect, beforeEach } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { MockSourceConnector } from "../src/data/source-connector.js";
import { MemoryPersistenceStore } from "../src/data/persistence-store.js";
import fechamentoRecipe from "../../../recipes/fechamento-mes.recipe.js";

describe("Bateria E2E Completa: Recipe Fechamento de Mês", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let sourceConnector: MockSourceConnector;
  let persistenceStore: MemoryPersistenceStore;
  const workspaceId = "ws_fechamento_jan_2026";

  beforeEach(() => {
    // 1. Mock do ERP Inovafarma com 3 vendedores reais
    sourceConnector = new MockSourceConnector({
      default: [
        { vendedor_id: 1, vendedor: "Carlos Vendedor", venda_geral: 10000 },
        { vendedor_id: 2, vendedor: "Ana Gerente", venda_geral: 25000 },
        { vendedor_id: 3, vendedor: "Bruno Balconista", venda_geral: 15000 },
      ],
    });

    persistenceStore = new MemoryPersistenceStore();

    app = createPlatformApp({
      sourceConnector,
      persistenceStore,
      recipes: {
        fechamento_mes: fechamentoRecipe,
      },
    });
  });

  it("1. [Segurança SDUI] Schema sanitizado deve ser entregue ao frontend sem expor SQL interno", async () => {
    const res = await app.request("/api/dashboards/fechamento_mes/schema");
    expect(res.status).toBe(200);
    const schema = (await res.json()) as Record<string, unknown>;

    expect(schema.id).toBe("fechamento_mes");
    expect(schema.name).toBe("Fechamento de Mês");
    expect(schema.sources).toBeUndefined(); // SQL do ERP é 100% ocultado do navegador!
    expect((schema.actions as Array<{ id: string }>).map((a) => a.id)).toEqual([
      "adicionar_penalidade",
      "visualizar_penalidades",
      "remover_penalidade",
    ]);
  });

  it("2. [Estado Inicial] KPIs e Tabela com valores padrão e cálculo de total a receber", async () => {
    // 2.1 KPI Total em Vendas (10k + 25k + 15k = 50k)
    const resKpiVendas = await app.request(
      `/api/workspaces/${workspaceId}/data/kpi_total_vendas?recipe_id=fechamento_mes`
    );
    const kpiVendas = await resKpiVendas.json();
    expect(kpiVendas.type).toBe("stat");
    expect(kpiVendas.value).toBe(50000);

    // 2.2 KPI Total em Penalidades (Inicial = 0)
    const resKpiPenalidades = await app.request(
      `/api/workspaces/${workspaceId}/data/kpi_total_penalidades?recipe_id=fechamento_mes`
    );
    const kpiPenalidades = await resKpiPenalidades.json();
    expect(kpiPenalidades.type).toBe("stat");
    expect(kpiPenalidades.value).toBe(0);

    // 2.3 KPI Total Líquido da Folha (1.500 * 3 = 4.500)
    const resKpiFolha = await app.request(
      `/api/workspaces/${workspaceId}/data/kpi_total_folha?recipe_id=fechamento_mes`
    );
    const kpiFolha = await resKpiFolha.json();
    expect(kpiFolha.type).toBe("stat");
    expect(kpiFolha.value).toBe(4500);

    // 2.4 Gráfico de Ranking (Top Vendedores completo)
    const resGrafico = await app.request(
      `/api/workspaces/${workspaceId}/data/grafico_ranking_vendas?recipe_id=fechamento_mes`
    );
    const grafico = await resGrafico.json();
    expect(grafico.type).toBe("chart");
    expect(grafico.data).toHaveLength(3);
    expect(grafico.data[0].name).toBe("Ana Gerente");
    expect(grafico.data[0].value).toBe(25000);

    // 2.5 Tabela consolidada com valores padrão (salário 1500, comissão 0, penalidade 0, total 1500)
    const resTabela = await app.request(
      `/api/workspaces/${workspaceId}/data/tabela_vendedores?recipe_id=fechamento_mes`
    );
    const tabela = await resTabela.json();
    expect(tabela.type).toBe("table");
    expect(tabela.data).toHaveLength(3);
    expect(tabela.data[0]["remuneracao_vendedor.salario_base"]).toBe(1500);
    expect(tabela.data[0]["remuneracao_vendedor.comissao_ajustada"]).toBe(0);
    expect(tabela.data[0]["penalidades_vendedor.total_penalidades"]).toBe(0);
    expect(tabela.data[0]["total_a_receber"]).toBe(1500);
  });

  it("3. [Edição Inline de Células] Salvar salário base e comissão diretamente na célula recalcula KPIs e total a receber", async () => {
    // Gerente altera Salário Base do Carlos (ID 1) para R$ 2.000,00
    const resEditSalario = await app.request(`/api/workspaces/${workspaceId}/persistence/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "remuneracao_vendedor",
        target_foreign_key_value: 1,
        field: "salario_base",
        value: 2000,
        workspace_version: 1,
      }),
    });
    expect(resEditSalario.status).toBe(200);

    // Gerente adiciona Comissão de R$ 600,00 para o Carlos (ID 1)
    const resEditComissao = await app.request(`/api/workspaces/${workspaceId}/persistence/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "remuneracao_vendedor",
        target_foreign_key_value: 1,
        field: "comissao_ajustada",
        value: 600,
        workspace_version: 2,
      }),
    });
    expect(resEditComissao.status).toBe(200);

    // Reconsulta os dados da tabela
    const resTabela = await app.request(
      `/api/workspaces/${workspaceId}/data/tabela_vendedores?recipe_id=fechamento_mes`
    );
    const tabela = await resTabela.json();

    // Carlos agora tem total_a_receber = 2000 + 600 - 0 = 2600
    const carlos = (tabela.data as Record<string, unknown>[]).find((v) => v.vendedor_id === 1)!;
    expect(carlos["remuneracao_vendedor.salario_base"]).toBe(2000);
    expect(carlos["remuneracao_vendedor.comissao_ajustada"]).toBe(600);
    expect(carlos["total_a_receber"]).toBe(2600);

    // Folha líquida total subiu de 4500 para 5600 (Carlos 2600 + Ana 1500 + Bruno 1500)
    const resKpiFolha = await app.request(
      `/api/workspaces/${workspaceId}/data/kpi_total_folha?recipe_id=fechamento_mes`
    );
    const kpiFolha = await resKpiFolha.json();
    expect(kpiFolha.value).toBe(5600);
  });

  it("4. [Action com Diálogo Imperativo] Inserir penalidade abate do total a receber e atualiza KPI", async () => {
    // Aplica salário do Carlos = 2000
    await persistenceStore.setScalar(workspaceId, "remuneracao_vendedor", 1, {
      salario_base: 2000,
      comissao_ajustada: 500,
    });

    // Dispara a Action de Adicionar Penalidade de R$ 150,00
    const resAction = await app.request(`/api/workspaces/${workspaceId}/actions/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipe_id: "fechamento_mes",
        action_id: "adicionar_penalidade",
        row: { vendedor_id: 1, vendedor: "Carlos Vendedor" },
        form_data: {
          valor: 150,
          reason: "Atraso no fechamento do caixa",
        },
        workspace_version: 3,
      }),
    });

    expect(resAction.status).toBe(200);
    const actionResult = await resAction.json();
    expect(actionResult.success).toBe(true);
    expect(actionResult.effects).toContainEqual({
      type: "toast",
      variant: "success",
      message: "Penalidade inserida com sucesso!",
    });
    expect(actionResult.effects).toContainEqual({ type: "refresh_data" });

    // Consulta KPI de Penalidades (subiu para 150)
    const resKpiPenalidades = await app.request(
      `/api/workspaces/${workspaceId}/data/kpi_total_penalidades?recipe_id=fechamento_mes`
    );
    const kpiPenalidades = await resKpiPenalidades.json();
    expect(kpiPenalidades.value).toBe(150);

    // Consulta linha do Carlos: total_a_receber = 2000 + 500 - 150 = 2350
    const resTabela = await app.request(
      `/api/workspaces/${workspaceId}/data/tabela_vendedores?recipe_id=fechamento_mes`
    );
    const tabela = await resTabela.json();
    const carlos = (tabela.data as Record<string, unknown>[]).find((v) => v.vendedor_id === 1)!;
    expect(carlos["penalidades_vendedor.total_penalidades"]).toBe(150);
    expect(carlos["total_a_receber"]).toBe(2350);

    // Folha líquida agora é 2350 + 1500 + 1500 = 5350
    const resKpiFolha = await app.request(
      `/api/workspaces/${workspaceId}/data/kpi_total_folha?recipe_id=fechamento_mes`
    );
    const kpiFolha = await resKpiFolha.json();
    expect(kpiFolha.value).toBe(5350);
  });

  it("5. [Sub-Tabela & Exclusão] Remover penalidade restaura o valor original", async () => {
    // Cria uma penalidade para o Carlos
    const created = await persistenceStore.pushItem(workspaceId, "penalidades_vendedor", 1, {
      value: 150,
      reason: "Atraso no caixa",
    });

    // Remove a penalidade via Action 'remover_penalidade'
    const resDelete = await app.request(`/api/workspaces/${workspaceId}/actions/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipe_id: "fechamento_mes",
        action_id: "remover_penalidade",
        row: { id: created.id, value: 150 },
        form_data: { __confirmed: true },
        workspace_version: 4,
      }),
    });

    expect(resDelete.status).toBe(200);
    const deleteResult = await resDelete.json();
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.effects).toContainEqual({
      type: "toast",
      variant: "success",
      message: "Penalidade removida com sucesso!",
    });

    // Confirma que a penalidade voltou para 0
    const resKpiPenalidades = await app.request(
      `/api/workspaces/${workspaceId}/data/kpi_total_penalidades?recipe_id=fechamento_mes`
    );
    const kpiPenalidades = await resKpiPenalidades.json();
    expect(kpiPenalidades.value).toBe(0);
  });

  it("6. [Ordenação & Busca Textual] Ordenar por venda_geral (DESC) e filtrar por busca", async () => {
    // 6.1 Ordenação decrescente por venda_geral: Ana (25k), Bruno (15k), Carlos (10k)
    const resOrdenado = await app.request(
      `/api/workspaces/${workspaceId}/data/tabela_vendedores?recipe_id=fechamento_mes&sort_by=venda_geral&order=desc`
    );
    const tabOrdenada = await resOrdenado.json();
    expect(tabOrdenada.data[0].vendedor).toBe("Ana Gerente");
    expect(tabOrdenada.data[0].venda_geral).toBe(25000);
    expect(tabOrdenada.data[1].vendedor).toBe("Bruno Balconista");
    expect(tabOrdenada.data[2].vendedor).toBe("Carlos Vendedor");

    // 6.2 Busca textual por "Bruno"
    const resBusca = await app.request(
      `/api/workspaces/${workspaceId}/data/tabela_vendedores?recipe_id=fechamento_mes&search=Bruno`
    );
    const tabBusca = await resBusca.json();
    expect(tabBusca.data).toHaveLength(1);
    expect(tabBusca.data[0].vendedor).toBe("Bruno Balconista");
    expect(tabBusca.meta.totalRecords).toBe(1);
  });
});
