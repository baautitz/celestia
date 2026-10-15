import { describe, it, expect } from "vitest";
import type { RecipeDef } from "@platform/shared";
import { createSeededUserStore, withAuth } from "./helpers/fixtures.js";
import { createPlatformApp } from "../src/index.js";
import { MockSourceConnector } from "../src/data/source-connector.js";

const recipeWith = (cumulative: boolean): RecipeDef => ({
  id: "series",
  name: "Séries",
  workspace: { params: [] },
  sources: {
    erp: {
      queries: {
        diarias: {
          primaryKey: "vendedor_id",
          options: [{ id: "todas", label: "Todas", permission: "recipe:series:query:diarias_todas", sql: "SELECT * FROM diarias" }],
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
        id: "linhas",
        component: "line_chart",
        layoutProps: { colSpan: 12 },
        props: { title: "L", source: "erp", query: "diarias", nameKey: "dia", valueKey: "valor", seriesKey: "vendedor", seriesLimit: 2, cumulative },
      },
    ],
  },
});

describe("line_chart com séries (uma linha por vendedor)", () => {
  const rows = [
    { dia: "2026-09-02", vendedor_id: 1, vendedor: "Ana", valor: 10 },
    { dia: "2026-09-01", vendedor_id: 1, vendedor: "Ana", valor: 5 },
    { dia: "2026-09-01", vendedor_id: 2, vendedor: "J.R. Silva", valor: 100 }, // ponto no nome: a chave da série não pode depender dele
    { dia: "2026-09-02", vendedor_id: 3, vendedor: "Beto", valor: 1 },
    { dia: "2026-09-03", vendedor_id: 2, vendedor: "J.R. Silva", valor: 50 },
  ];

  it("pivota por dia, mantém só as séries de maior total e preenche com 0", async () => {
    const app = createPlatformApp({ userStore: createSeededUserStore({ admin: true }), recipes: { series: recipeWith(false) }, sourceConnector: new MockSourceConnector({ default: rows }) });
    withAuth(app, "test.root");
    const res = await app.request("/api/workspaces/preview/data/linhas?recipe_id=series&start_date=2026-09-01&end_date=2026-09-30");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { series: { key: string; label: string }[]; data: Array<Record<string, unknown>> };

    // seriesLimit 2: J.R. Silva (150) e Ana (15); Beto (1) fica de fora
    expect(body.series).toEqual([
      { key: "s0", label: "J.R. Silva" },
      { key: "s1", label: "Ana" },
    ]);
    expect(body.data.map((point) => point.name)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]); // eixo X em ordem
    expect(body.data[0]).toMatchObject({ name: "2026-09-01", s0: 100, s1: 5, value: 105 });
    expect(body.data[1]).toMatchObject({ name: "2026-09-02", s0: 0, s1: 10, value: 10 }); // Beto excluído do total
    expect(body.data[2]).toMatchObject({ name: "2026-09-03", s0: 50, s1: 0, value: 50 });
  });

  it("com cumulative, cada série vira a soma corrida e repete o acumulado nos dias sem venda", async () => {
    const app = createPlatformApp({ userStore: createSeededUserStore({ admin: true }), recipes: { series: recipeWith(true) }, sourceConnector: new MockSourceConnector({ default: rows }) });
    withAuth(app, "test.root");
    const res = await app.request("/api/workspaces/preview/data/linhas?recipe_id=series&start_date=2026-09-01&end_date=2026-09-30");
    const body = (await res.json()) as { data: Array<Record<string, number | string>> };

    // s0 = J.R. Silva (100 no dia 1, 50 no dia 3); s1 = Ana (5 no dia 1, 10 no dia 2)
    expect(body.data[0]).toMatchObject({ name: "2026-09-01", s0: 100, s1: 5, value: 105 });
    expect(body.data[1]).toMatchObject({ name: "2026-09-02", s0: 100, s1: 15, value: 115 }); // J.R. repete 100; Ana acumula 5+10
    expect(body.data[2]).toMatchObject({ name: "2026-09-03", s0: 150, s1: 15, value: 165 }); // último ponto = total do período
  });
});
