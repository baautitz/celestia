import { describe, it, expect, beforeEach } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { MockSourceConnector } from "../src/data/source-connector.js";
import { MemoryPersistenceStore } from "../src/data/persistence-store.js";
import type { RecipeDef } from "@platform/shared";

describe("Hono API Integration Test (End-to-End)", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let sourceConnector: MockSourceConnector;
  let persistenceStore: MemoryPersistenceStore;

  const fechamentoRecipe: RecipeDef = {
    id: "fechamento_mes",
    name: "Fechamento de Mês",
    workspace: {
      params: [
        { name: "start_date", label: "Data Inicial", type: "date", required: true },
        { name: "end_date", label: "Data Final", type: "date", required: true },
      ],
    },
    sources: {
      inovafarma: {
        primaryKey: "vendedor_id",
        queries: {
          default: { query: "SELECT * FROM vendas" },
        },
      },
    },
    persistence: [
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
    actions: [
      {
        id: "aprovar_fechamento",
        label: "Aprovar Fechamento",
        action: async ({ row, ui }) => {
          ui.toast.success(`Fechamento do vendedor ${row.vendedor} aprovado!`);
          ui.refresh();
        },
      },
    ],
    ui: {
      layout: { type: "grid", columns: 12 },
      components: [
        {
          id: "tabela_vendedores",
          component: "data_table",
          props: {
            source: "inovafarma",
            columns: [
              { key: "vendedor_id", label: "ID" },
              { key: "vendedor", label: "Vendedor" },
              { key: "venda_geral", label: "Venda Geral" },
            ],
          },
        },
      ],
    },
  };

  beforeEach(() => {
    sourceConnector = new MockSourceConnector({
      default: [
        { vendedor_id: 1, vendedor: "Carlos Vendedor", venda_geral: 10000 },
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

  it("GET /api/health deve responder status ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("GET /api/dashboards/fechamento_mes/schema deve retornar o schema sem expor SQL", async () => {
    const res = await app.request("/api/dashboards/fechamento_mes/schema");
    expect(res.status).toBe(200);
    const schema = await res.json();

    expect(schema.id).toBe("fechamento_mes");
    expect(schema.name).toBe("Fechamento de Mês");
    expect(schema.actions).toHaveLength(1);
    expect(schema.actions[0].id).toBe("aprovar_fechamento");
    // Não deve conter queries SQL cruas
    expect((schema as Record<string, unknown>).sources).toBeUndefined();
  });

  it("GET /api/workspaces/:id/data/tabela_vendedores deve retornar dados fundidos", async () => {
    const res = await app.request("/api/workspaces/ws_101/data/tabela_vendedores?recipe_id=fechamento_mes");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].vendedor).toBe("Carlos Vendedor");
    expect(body.data[0]["remuneracao_vendedor.salario_base"]).toBe(1500);
    expect(body.meta.totalRecords).toBe(1);
  });

  it("POST /api/workspaces/:id/actions/exec deve executar RPC de ação", async () => {
    const res = await app.request("/api/workspaces/ws_101/actions/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipe_id: "fechamento_mes",
        action_id: "aprovar_fechamento",
        row: { vendedor_id: 1, vendedor: "Carlos Vendedor" },
        workspace_version: 1,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.effects).toContainEqual({
      type: "toast",
      variant: "success",
      message: "Fechamento do vendedor Carlos Vendedor aprovado!",
    });
    expect(body.newWorkspaceVersion).toBe(2);
  });

  it("POST /api/workspaces/:id/persistence/set deve salvar edição inline de célula", async () => {
    const res = await app.request("/api/workspaces/ws_101/persistence/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "remuneracao_vendedor",
        target_foreign_key_value: 1,
        field: "salario_base",
        value: 2200,
        workspace_version: 3,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.new_version).toBe(4);

    // Verifica se gravou na persistência
    const scalar = await persistenceStore.getScalar("ws_101", "remuneracao_vendedor", 1);
    expect(scalar?.salario_base).toBe(2200);
  });
});
