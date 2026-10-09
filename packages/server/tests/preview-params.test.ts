import { describe, it, expect, beforeEach } from "vitest";
import type { RecipeDef } from "@platform/shared";
import { createPlatformApp } from "../src/index.js";
import type { SourceConnector } from "../src/data/source-connector.js";

const recipe: RecipeDef = {
  id: "com_empresa",
  name: "Com empresa",
  workspace: {
    params: [
      { name: "start_date", label: "Data Inicial", type: "date", required: true },
      { name: "end_date", label: "Data Final", type: "date", required: true },
      { name: "empresa", label: "Empresa", type: "number", required: false },
    ],
  },
  sources: {
    erp: {
      queries: {
        vendas: {
          primaryKey: "id",
          options: [
            {
              id: "todas",
              label: "Todas",
              permission: "recipe:com_empresa:query:vendas_todas",
              sql: "SELECT id FROM vendas WHERE (({{workspace.empresa}} IS NULL) OR empresa = {{workspace.empresa}}) AND dt >= {{workspace.start_date}}",
            },
          ],
        },
      },
    },
  },
  persistence: [],
  actions: [],
  ui: {
    layout: { type: "grid", columns: 12, gap: 16 },
    components: [
      {
        id: "tabela",
        component: "data_table",
        layoutProps: { colSpan: 12 },
        props: { title: "T", source: "erp", query: "vendas", columns: [{ key: "id", label: "ID" }] },
      },
    ],
  },
};

describe("Parâmetros do Modelo sem Área de Trabalho (prévia)", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let calls: { sql: string; params?: Record<string, unknown> }[];

  beforeEach(() => {
    calls = [];
    const connector: SourceConnector = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return [{ id: 1 }];
      },
    };
    app = createPlatformApp({
      sourceConnectors: { erp: connector },
      recipes: { com_empresa: recipe },
      workspaces: [
        { id: "ws_real", recipeId: "com_empresa", name: "Real", startDate: "2026-01-01", endDate: "2026-01-31", status: "open", params: { empresa: 9 }, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      ],
    });
  });

  const get = (workspace: string, extra = "") =>
    app.request(`/api/workspaces/${workspace}/data/tabela?recipe_id=com_empresa&start_date=2026-01-01&end_date=2026-01-31${extra}`);
  const withParams = (value: unknown) => `&params=${encodeURIComponent(JSON.stringify(value))}`;

  it("aplica os parâmetros enviados na consulta, como bind parameters (nunca no texto do SQL)", async () => {
    const res = await get("preview", withParams({ empresa: 3 }));
    expect(res.status).toBe(200);
    expect(Object.values(calls[0]!.params!)).toContain(3);
    expect(calls[0]!.sql).not.toMatch(/=\s*3\b/); // o valor nunca vira literal no SQL
    expect(calls[0]!.sql).toMatch(/empresa = @p\d/);
  });

  it("sem parâmetro, o valor chega como NULL (sem filtro)", async () => {
    await get("preview");
    expect(calls[0]!.params!.p1).toBeNull();
  });

  it("ignora parâmetros que o Modelo não declarou", async () => {
    await get("preview", withParams({ empresa: 3, "1; DROP TABLE vendas": "x", intruso: "y" }));
    expect(Object.values(calls[0]!.params!)).not.toContain("x");
    expect(Object.values(calls[0]!.params!)).not.toContain("y");
  });

  it("recusa params que não seja um objeto JSON", async () => {
    expect((await get("preview", "&params=nao-e-json")).status).toBe(400);
    expect((await get("preview", withParams([1, 2]))).status).toBe(400);
    expect((await get("preview", withParams("texto"))).status).toBe(400);
  });

  it("numa Área de Trabalho real, os parâmetros dela têm prioridade", async () => {
    await get("ws_real", withParams({ empresa: 3 }));
    expect(Object.values(calls[0]!.params!)).toContain(9);
    expect(Object.values(calls[0]!.params!)).not.toContain(3);
  });
});
