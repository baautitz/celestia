import { describe, it, expect, beforeEach } from "vitest";
import { DataResolver } from "../src/data/data-resolver.js";
import { MockSourceConnector } from "../src/data/source-connector.js";
import { MemoryPersistenceStore } from "../src/data/persistence-store.js";
import type { RecipeDef } from "@platform/shared";

describe("DataResolver (Tabelas Paginadas vs Gráficos & KPIs Totais)", () => {
  let sourceConnector: MockSourceConnector;
  let persistenceStore: MemoryPersistenceStore;

  const mockRecipe: RecipeDef = {
    id: "fechamento_mes",
    name: "Fechamento de Mês",
    workspace: { params: [] },
    sources: {
      inovafarma: {
        primaryKey: "vendedor_id",
        queries: {
          default: {
            query: "SELECT * FROM vendas",
          },
        },
      },
    },
    persistence: [
      {
        id: "penalidades_vendedor",
        targetSource: "inovafarma",
        targetForeignKey: "vendedor_id",
        mode: "collection",
        itemSchema: {
          value: { type: "money", defaultValue: 0 },
          reason: { type: "text", defaultValue: "" },
        },
        computedFields: {
          total_penalidades: {
            type: "money",
            aggregate: { function: "sum", field: "value" },
          },
        },
      },
      {
        id: "remuneracao_vendedor",
        targetSource: "inovafarma",
        targetForeignKey: "vendedor_id",
        mode: "scalar",
        itemSchema: {
          salario_base: { type: "money", defaultValue: 1500 },
          comissao_ajustada: { type: "money", defaultValue: 0 },
        },
      },
    ],
    actions: [],
    ui: {
      layout: { type: "grid", columns: 12 },
      components: [
        {
          id: "kpi_total_vendas",
          component: "stat_card",
          props: {
            title: "Total em Vendas",
            source: "inovafarma",
            aggregate: { function: "sum", field: "venda_geral" },
          },
        },
        {
          id: "grafico_vendedores",
          component: "bar_chart",
          props: {
            source: "inovafarma",
            nameKey: "vendedor",
            valueKey: "venda_geral",
          },
        },
        {
          id: "tabela_vendedores",
          component: "data_table",
          props: {
            source: "inovafarma",
            columns: [
              { key: "vendedor_id", label: "ID" },
              { key: "vendedor", label: "Vendedor" },
              { key: "venda_geral", label: "Venda Geral" },
              { key: "remuneracao_vendedor.salario_base", label: "Salário Base" },
              { key: "remuneracao_vendedor.comissao_ajustada", label: "Comissão" },
              { key: "penalidades_vendedor.total_penalidades", label: "Penalidades (-)" },
              {
                key: "total_a_receber",
                label: "Total a Receber (=)",
                compute: (row) => {
                  const salario = Number(row["remuneracao_vendedor.salario_base"] || 0);
                  const comissao = Number(row["remuneracao_vendedor.comissao_ajustada"] || 0);
                  const penalidades = Number(row["penalidades_vendedor.total_penalidades"] || 0);
                  return salario + comissao - penalidades;
                },
              },
            ],
          },
        },
      ],
    },
  };

  beforeEach(() => {
    sourceConnector = new MockSourceConnector({
      default: [
        { vendedor_id: 1, vendedor: "João Silva", venda_geral: 5000 },
        { vendedor_id: 2, vendedor: "Maria Souza", venda_geral: 8000 },
      ],
    });
    persistenceStore = new MemoryPersistenceStore();
  });

  it("deve resolver data_table com paginação e colunas calculadas", async () => {
    await persistenceStore.pushItem("ws_101", "penalidades_vendedor", 1, { value: 50, reason: "Atraso" });
    await persistenceStore.setScalar("ws_101", "remuneracao_vendedor", 1, {
      salario_base: 1800,
      comissao_ajustada: 250,
    });

    const result = await DataResolver.resolveComponentData({
      recipe: mockRecipe,
      workspaceId: "ws_101",
      componentId: "tabela_vendedores",
      sourceConnector,
      persistenceStore,
      context: {
        workspace: { startDate: "2026-01-01", endDate: "2026-01-31" },
      },
    });

    expect(result.type).toBe("table");
    if (result.type === "table") {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].total_a_receber).toBe(2000); // 1800 + 250 - 50
      expect(result.meta.totalRecords).toBe(2);
    }
  });

  it("deve resolver stat_card retornando o valor único consolidado (sem paginação)", async () => {
    const result = await DataResolver.resolveComponentData({
      recipe: mockRecipe,
      workspaceId: "ws_101",
      componentId: "kpi_total_vendas",
      sourceConnector,
      persistenceStore,
      context: {
        workspace: { startDate: "2026-01-01", endDate: "2026-01-31" },
      },
    });

    expect(result.type).toBe("stat");
    if (result.type === "stat") {
      // 5000 + 8000 = 13000
      expect(result.value).toBe(13000);
      expect(result.title).toBe("Total em Vendas");
    }
  });

  it("deve resolver bar_chart retornando todas as séries de dados sem paginação", async () => {
    const result = await DataResolver.resolveComponentData({
      recipe: mockRecipe,
      workspaceId: "ws_101",
      componentId: "grafico_vendedores",
      sourceConnector,
      persistenceStore,
      context: {
        workspace: { startDate: "2026-01-01", endDate: "2026-01-31" },
      },
    });

    expect(result.type).toBe("chart");
    if (result.type === "chart") {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe("Maria Souza");
      expect(result.data[0].value).toBe(8000);
      expect(result.data[1].name).toBe("João Silva");
      expect(result.data[1].value).toBe(5000);
    }
  });
});
