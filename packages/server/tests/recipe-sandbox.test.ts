import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { ActionContext, DataTableColumnDef, ImperativeUIContext, UIEffect } from "@platform/shared";
import { RecipeCompiler } from "../src/engine/compiler.js";
import { isBatchable } from "../src/engine/recipe-sandbox.js";
import { createPlatformApp } from "../src/index.js";
import { MockSourceConnector } from "../src/data/source-connector.js";
import { MemoryPersistenceStore } from "../src/data/persistence-store.js";
import { createSeededUserStore, seededWorkspaces } from "./helpers/fixtures.js";

const recipeSource = (id: string, columns: string, actions = "") => `
import { defineRecipe } from "@platform/shared";
export default defineRecipe({
  id: "${id}", name: "Sandbox", workspace: { params: [] }, sources: {}, persistence: [],
  actions: [${actions}],
  ui: { layout: { type: "grid", columns: 12, gap: 16 }, components: [
    { id: "c", component: "data_table", props: { title: "t", source: "s", columns: [${columns}] } },
  ] },
});
`;

describe("Modelos em isolate do V8 (recipe-sandbox)", () => {
  const compiler = new RecipeCompiler();

  async function computeOf(id: string, columns: string) {
    const recipe = await compiler.compile(id, recipeSource(id, columns));
    const column = (recipe.ui.components[0]!.props.columns as DataTableColumnDef[])[0]!;
    if (!isBatchable<Record<string, unknown>, unknown>(column.compute)) throw new Error("compute deveria ser um proxy em lote");
    return column.compute;
  }

  it("executa compute isolado, um a um e em lote", async () => {
    const compute = await computeOf("sb_compute", `{ key: "x", label: "X", compute: (row) => row.a * 2 }`);
    expect(await compute({ a: 21 })).toBe(42);
    expect(await compute.batch([{ a: 1 }, { a: 2 }, { a: 3 }])).toEqual([2, 4, 6]);
  });

  it("não expõe nada do host ao código do Modelo", async () => {
    const compute = await computeOf(
      "sb_escape",
      `{ key: "x", label: "X", compute: () => [
          typeof process,
          typeof require("fs").readFileSync,
          (0, eval)("typeof process"),
          Function("return typeof process")(),
          Function("return typeof globalThis.__hostCall")(),
        ] }`
    );
    // __hostCall existe só para a ponte das actions; o código do Modelo não consegue usá-la para sair do isolate.
    expect(await compute({})).toEqual(["undefined", "undefined", "undefined", "undefined", "object"]);
  });

  it("interrompe laço infinito e continua utilizável", async () => {
    const compute = await computeOf("sb_loop", `{ key: "x", label: "X", compute: (row) => { if (row.travar) { while (true) {} } return 1; } }`);
    await expect(compute({ travar: true })).rejects.toThrow(/time/i);
    expect(await compute({ travar: false })).toBe(1);
  });

  it("contém estouro de memória no isolate e se recupera", async () => {
    const compute = await computeOf(
      "sb_mem",
      `{ key: "x", label: "X", compute: (row) => { if (row.explodir) { const lixo = []; while (true) lixo.push(new Array(1e6).fill(1)); } return 7; } }`
    );
    await expect(compute({ explodir: true })).rejects.toThrow();
    expect(await compute({ explodir: false })).toBe(7);
  });

  it("não troca a versão válida quando a nova é inválida ou tem outro id", async () => {
    const compute = await computeOf("sb_keep", `{ key: "x", label: "X", compute: () => 1 }`);
    await expect(compiler.compile("sb_keep", "export default defineRecipe({")).rejects.toThrow();
    await expect(compiler.compile("sb_keep", recipeSource("outro_id", `{ key: "x", label: "X" }`))).rejects.toThrow(/deve ser igual/);
    expect(await compute({})).toBe(1);
  });

  describe("actions", () => {
    const makeCtx = (effects: UIEffect[], row: Record<string, unknown>): ActionContext => {
      const toast = (variant: "success" | "error" | "warning" | "info") => (message: string) => effects.push({ type: "toast", variant, message });
      const ui: ImperativeUIContext = {
        confirm: async () => false,
        prompt: async () => null,
        alert: async () => undefined,
        dialog: { open: async () => null, showTable: async () => undefined },
        toast: { success: toast("success"), error: toast("error"), warning: toast("warning"), info: toast("info") },
        refresh: () => {
          effects.push({ type: "refresh_data" });
        },
      };
      return {
        row,
        ui,
        persistence: {
          push: async (_collection, item) => ({ id: "item_42", ...item }),
          set: async () => ({}),
          delete: async () => undefined,
        },
        workspace: { id: "ws", startDate: "2026-01-01", endDate: "2026-01-31", params: {}, version: 1 },
      };
    };

    const actions = `
      { id: "a", label: "A", permission: "recipe:sb_act:action:a", action: async ({ row, ui, persistence }) => {
          ui.toast.info("um");
          ui.toast.success("dois");
          const salvo = await persistence.push("col", { v: row.v });
          ui.toast.warning("id:" + salvo.id + ":v=" + salvo.v);
          ui.refresh();
      } },
      { id: "boom", label: "B", permission: "recipe:sb_act:action:boom", action: async () => { throw new Error("falhou no modelo"); } }
    `;

    it("chama ui/persistence do host, em ordem, mesmo sem await, e devolve valores", async () => {
      const recipe = await compiler.compile("sb_act", recipeSource("sb_act", `{ key: "x", label: "X" }`, actions));
      const effects: UIEffect[] = [];
      await recipe.actions[0]!.action(makeCtx(effects, { v: 9 }));
      expect(effects.map((e) => (e.type === "toast" ? e.message : e.type))).toEqual(["um", "dois", "id:item_42:v=9", "refresh_data"]);
    });

    it("propaga o erro lançado pelo código do Modelo", async () => {
      const recipe = await compiler.compile("sb_act", recipeSource("sb_act", `{ key: "x", label: "X" }`, actions));
      await expect(recipe.actions[1]!.action(makeCtx([], {}))).rejects.toThrow(/falhou no modelo/);
    });
  });
});

describe("fechamento_mes carregado no isolate (fluxo completo pela API)", () => {
  it("calcula colunas/KPIs e executa actions com persistência", async () => {
    const source = readFileSync(new URL("./fixtures/fechamento-mes.recipe.ts", import.meta.url), "utf8");
    const recipe = await new RecipeCompiler().compile("fechamento_mes", source);
    const app = createPlatformApp({
      userStore: createSeededUserStore(),
      workspaces: seededWorkspaces,
      persistenceStore: new MemoryPersistenceStore(),
      sourceConnector: new MockSourceConnector({
        default: [
          { vendedor_id: 1, vendedor: "Carlos Vendedor", venda_geral: 10000 },
          { vendedor_id: 2, vendedor: "Ana Gerente", venda_geral: 25000 },
        ],
      }),
      recipes: { fechamento_mes: recipe },
    });
    const get = async (component: string) =>
      (await (await app.request(`/api/workspaces/ws_fechamento_jan_2026/data/${component}?recipe_id=fechamento_mes`)).json()) as {
        value?: number;
        data?: Array<Record<string, unknown>>;
      };

    // compute do KPI (2 vendedores x salário base padrão 1.500)
    expect((await get("kpi_total_folha")).value).toBe(3000);
    const before = (await get("tabela_vendedores")).data!.find((r) => r.vendedor_id === 1)!;
    expect(before.total_a_receber).toBe(1500);

    // action de mutação (persistence.push + ui.toast) rodando no isolate
    const res = await app.request("/api/workspaces/ws_fechamento_jan_2026/actions/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipe_id: "fechamento_mes",
        component_id: "tabela_vendedores",
        action_id: "adicionar_penalidade",
        row: { vendedor_id: 1, vendedor: "Carlos Vendedor" },
        form_data: { valor: 150, reason: "Atraso" },
        workspace_version: 1,
      }),
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as { success: boolean; effects: UIEffect[] };
    expect(result.success).toBe(true);
    expect(result.effects).toContainEqual({ type: "toast", variant: "success", message: "Penalidade inserida com sucesso!" });

    const after = (await get("tabela_vendedores")).data!.find((r) => r.vendedor_id === 1)!;
    expect(after.total_a_receber).toBe(1350);
    expect((await get("kpi_total_penalidades")).value).toBe(150);
  });
});
