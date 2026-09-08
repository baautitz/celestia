import { describe, expect, it } from "vitest";
import type { PermissionCatalog, QueryOptionDef, RecipeDef } from "@platform/shared";
import { DataResolver } from "../src/data/data-resolver.js";
import { MemoryPersistenceStore } from "../src/data/persistence-store.js";
import { MockSourceConnector } from "../src/data/source-connector.js";
import { PermissionCatalogEngine } from "../src/iam/permission-catalog.js";
import { PermissionResolver } from "../src/iam/permission-resolver.js";

const namedQueryRecipe: RecipeDef = {
  id: "named_queries",
  name: "Queries Nomeadas",
  workspace: { params: [] },
  sources: {
    vendas: {
      queries: {
        vendas: {
          primaryKey: "id",
          options: [
            {
              id: "regiao",
              label: "Por região",
              permission: "recipe:named_queries:query:vendas_regiao",
              sql: "SELECT * FROM vendas_por_regiao",
            },
            {
              id: "filial",
              label: "Por filial",
              permission: "recipe:named_queries:query:vendas_filial",
              sql: "SELECT * FROM vendas_por_filial",
            },
          ],
        },
        metas: {
          primaryKey: "id",
          options: [
            {
              id: "principal",
              label: "Meta principal",
              permission: "recipe:named_queries:query:metas_principal",
              sql: "SELECT * FROM metas_vendas",
            },
          ],
        },
      },
    },
    resumo: {
      queries: {
        resumo: {
          primaryKey: "metric",
          options: [
            {
              id: "regiao",
              label: "Por região",
              permission: "recipe:named_queries:query:resumo_regiao",
              sql: "SELECT * FROM resumo_por_regiao",
            },
          ],
        },
      },
    },
  },
  persistence: [
    {
      id: "ajustes",
      targetSource: "vendas",
      targetForeignKey: "id",
      mode: "collection",
      itemSchema: { valor: { type: "money", defaultValue: 0 } },
      computedFields: {
        total_ajustes: { type: "money", aggregate: { function: "sum", field: "valor" } },
      },
    },
  ],
  actions: [],
  ui: {
    layout: { type: "grid", columns: 12 },
    components: [
      {
        id: "tabela_vendas",
        component: "data_table",
        props: {
          source: "vendas",
          query: "vendas",
          columns: [{ key: "id", label: "ID" }],
        },
      },
      {
        id: "grafico_vendas",
        component: "bar_chart",
        props: {
          source: "vendas",
          query: "vendas",
          nameKey: "nome",
          valueKey: "valor",
        },
      },
      {
        id: "kpi_resumo",
        component: "stat_card",
        props: {
          title: "Resumo",
          source: "resumo",
          query: "resumo",
          aggregate: { function: "sum", field: "valor" },
        },
      },
      {
        id: "tabela_completa",
        component: "data_table",
        props: {
          source: "vendas",
          query: "vendas",
          bindings: [
            { id: "vendas", source: "vendas", query: "vendas", joinKey: "id", primary: true },
            { id: "metas", source: "vendas", query: "metas", joinKey: "id" },
            { id: "ajustes", persistence: "ajustes", joinKey: "id" },
          ],
          profiles: [
            { id: "regiao_completa", label: "Região completa", options: { vendas: "regiao", metas: "principal" } },
            { id: "filial_completa", label: "Filial completa", options: { vendas: "filial", metas: "principal" } },
          ],
          columns: [
            { key: "nome", label: "Nome" },
            { key: "metas.meta", label: "Meta" },
            { key: "ajustes.total_ajustes", label: "Ajustes" },
          ],
        },
      },
    ],
  },
};

describe("Queries nomeadas com opções permissionadas", () => {
  it("seleciona a primeira opção autorizada na ordem declarada", () => {
    const resolved = PermissionResolver.resolveQueryOption({
      recipeId: namedQueryRecipe.id,
      sourceName: "vendas",
      queryName: "vendas",
      sourceDef: namedQueryRecipe.sources.vendas,
      userPermissions: ["recipe:named_queries:query:vendas_filial"],
    });

    expect(resolved.option.id).toBe("filial");
    expect(resolved.matchedPermission).toBe("recipe:named_queries:query:vendas_filial");
    expect(resolved.option.sql).toContain("vendas_por_filial");
  });

  it("quando possui duas permissões, usa a primeira opção declarada por padrão", () => {
    const resolved = PermissionResolver.resolveQueryOption({
      recipeId: namedQueryRecipe.id,
      sourceName: "vendas",
      queryName: "vendas",
      sourceDef: namedQueryRecipe.sources.vendas,
      userPermissions: [
        "recipe:named_queries:query:vendas_filial",
        "recipe:named_queries:query:vendas_regiao",
      ],
    });

    expect(resolved.option.id).toBe("regiao");
  });

  it("permite selecionar explicitamente uma opção autorizada", () => {
    const resolved = PermissionResolver.resolveQueryOption({
      recipeId: namedQueryRecipe.id,
      sourceName: "vendas",
      queryName: "vendas",
      sourceDef: namedQueryRecipe.sources.vendas,
      userPermissions: [
        "recipe:named_queries:query:vendas_filial",
        "recipe:named_queries:query:vendas_regiao",
      ],
      optionId: "filial",
    });

    expect(resolved.option.id).toBe("filial");
  });

  it("aceita permissões personalizadas sem depender do nome da opção", () => {
    const sourceDef = {
      queries: {
        vendas: {
          primaryKey: "id",
          options: [{ id: "all", label: "Todos", permission: "business:reports:team", sql: "SELECT 1" }],
        },
      },
    } satisfies RecipeDef["sources"][string];

    const resolved = PermissionResolver.resolveQueryOption({
      recipeId: "named_queries",
      sourceName: "vendas",
      queryName: "vendas",
      sourceDef,
      userPermissions: ["business:reports:team"],
    });

    expect(resolved.option.id).toBe("all");
    expect(resolved.matchedPermission).toBe("business:reports:team");
  });

  it("bloqueia a source quando nenhuma opção está autorizada", () => {
    expect(() =>
      PermissionResolver.resolveQueryOption({
        recipeId: namedQueryRecipe.id,
        sourceName: "vendas",
        queryName: "vendas",
        sourceDef: namedQueryRecipe.sources.vendas,
        userPermissions: ["recipe:named_queries:query:inexistente"],
      })
    ).toThrow("Acesso negado");
  });

  it("cataloga cada opção mantendo a query lógica", () => {
    const catalog = PermissionCatalogEngine.buildCatalog({
      [namedQueryRecipe.id]: namedQueryRecipe,
    }) as PermissionCatalog;
    const permissions = catalog.recipes[0].queryPermissions;

    expect(permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "recipe:named_queries:query:vendas_regiao",
          label: "Consulta VENDAS: vendas — Por região",
        }),
        expect.objectContaining({
          key: "recipe:named_queries:query:resumo_regiao",
          label: "Consulta RESUMO: resumo — Por região",
        }),
      ])
    );
  });

  it("gera a permissão padrão da query quando option não informa permission", () => {
    const option: QueryOptionDef = { id: "self", label: "Próprias", sql: "SELECT 1" };
    expect(PermissionResolver.getQueryOptionPermission("named_queries", "vendas", option)).toBe(
      "recipe:named_queries:query:vendas"
    );
  });

  it("permite que componentes escolham profiles diferentes usando a mesma query", async () => {
    const sourceConnector = new MockSourceConnector({
      vendas_por_filial: [{ id: 1, nome: "Filial A", valor: 100 }],
      vendas_por_regiao: [{ id: 2, nome: "Região Sul", valor: 200 }],
      metas_vendas: [{ id: 1, meta: 500 }],
      resumo_por_regiao: [{ metric: "faturamento", valor: 1000 }],
    });
    const context = {
      workspace: { startDate: "2026-01-01", endDate: "2026-01-31" },
      user: {
        permissions: [
          "recipe:named_queries:query:vendas_filial",
          "recipe:named_queries:query:vendas_regiao",
          "recipe:named_queries:query:resumo_regiao",
          "recipe:named_queries:query:metas_principal",
        ],
      },
    };

    const table = await DataResolver.resolveComponentData({
      recipe: namedQueryRecipe,
      workspaceId: "ws_named",
      componentId: "tabela_vendas",
      sourceConnector,
      persistenceStore: new MemoryPersistenceStore(),
      profileId: "filial",
      context,
    });
    const chart = await DataResolver.resolveComponentData({
      recipe: namedQueryRecipe,
      workspaceId: "ws_named",
      componentId: "grafico_vendas",
      sourceConnector,
      persistenceStore: new MemoryPersistenceStore(),
      profileId: "regiao",
      context,
    });
    const stat = await DataResolver.resolveComponentData({
      recipe: namedQueryRecipe,
      workspaceId: "ws_named",
      componentId: "kpi_resumo",
      sourceConnector,
      persistenceStore: new MemoryPersistenceStore(),
      context,
    });

    expect(table.type).toBe("table");
    expect(chart.type).toBe("chart");
    expect(stat).toEqual({ type: "stat", value: 1000, title: "Resumo" });
    if (table.type === "table") expect(table.data[0].nome).toBe("Filial A");
    if (chart.type === "chart") expect(chart.data[0].name).toBe("Região Sul");
  });

  it("compõe duas queries da mesma source com uma persistence pelo profile", async () => {
    const persistenceStore = new MemoryPersistenceStore();
    await persistenceStore.pushItem("ws_composite", "ajustes", 1, { valor: 25 });

    const result = await DataResolver.resolveComponentData({
      recipe: namedQueryRecipe,
      workspaceId: "ws_composite",
      componentId: "tabela_completa",
      sourceConnector: new MockSourceConnector({
        vendas_por_filial: [{ id: 1, nome: "Filial A", valor: 100 }],
        metas_vendas: [{ id: 1, meta: 500 }],
      }),
      persistenceStore,
      profileId: "filial_completa",
      context: {
        workspace: { startDate: "2026-01-01", endDate: "2026-01-31" },
        user: {
          permissions: [
            "recipe:named_queries:query:vendas_filial",
            "recipe:named_queries:query:metas_principal",
          ],
        },
      },
    });

    expect(result.type).toBe("table");
    if (result.type === "table") {
      expect(result.data[0].nome).toBe("Filial A");
      expect(result.data[0]["metas.meta"]).toBe(500);
      expect(result.data[0]["ajustes.total_ajustes"]).toBe(25);
    }
  });
});
