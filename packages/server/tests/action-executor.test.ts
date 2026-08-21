import { describe, it, expect, beforeEach } from "vitest";
import { ActionExecutor } from "../src/engine/action-executor.js";
import { MemoryPersistenceStore } from "../src/data/persistence-store.js";
import type { RecipeDef } from "@platform/shared";

describe("ActionExecutor (Execução de Actions Imperativas)", () => {
  let persistenceStore: MemoryPersistenceStore;

  const mockRecipe: RecipeDef = {
    id: "fechamento_mes",
    name: "Fechamento de Mês",
    workspace: { params: [] },
    sources: {
      inovafarma: {
        primaryKey: "vendedor_id",
        queries: {},
      },
    },
    persistence: [],
    actions: [
      {
        id: "adicionar_penalidade",
        label: "Adicionar Penalidade",
        action: async ({ row, ui, persistence }) => {
          const form = await ui.dialog.open({
            title: "Adicionar Penalidade",
            fields: [],
          });
          if (!form) return;

          await persistence.push("penalidades_vendedor", {
            value: form.valor,
            reason: form.motivo,
          });

          ui.toast.success("Penalidade gravada!");
          ui.refresh();
        },
      },
      {
        id: "remover_penalidade",
        label: "Remover Penalidade",
        action: async ({ row, ui, persistence }) => {
          const ok = await ui.confirm("Remover?", "Tem certeza?");
          if (!ok) return;

          await persistence.delete("penalidades_vendedor", row.penalidade_id);
          ui.toast.success("Penalidade removida!");
          ui.refresh();
        },
      },
    ],
    ui: {
      layout: { type: "grid", columns: 12 },
      components: [],
    },
  };

  beforeEach(() => {
    persistenceStore = new MemoryPersistenceStore();
  });

  it("deve executar adicionar_penalidade e gerar os efeitos de UI (toast + refresh_data)", async () => {
    const result = await ActionExecutor.execute({
      recipe: mockRecipe,
      actionId: "adicionar_penalidade",
      row: { vendedor_id: 42, vendedor: "João" },
      formData: { valor: 50, motivo: "Atraso no caixa" },
      workspaceId: "ws_101",
      workspaceVersion: 1,
      persistenceStore,
    });

    expect(result.success).toBe(true);
    expect(result.newWorkspaceVersion).toBe(2);
    expect(result.effects).toContainEqual({
      type: "toast",
      variant: "success",
      message: "Penalidade gravada!",
    });
    expect(result.effects).toContainEqual({ type: "refresh_data" });

    // Verifica se gravou na persistência
    const items = await persistenceStore.getItems("ws_101", "penalidades_vendedor", 42);
    expect(items).toHaveLength(1);
    expect(items[0].data.value).toBe(50);
    expect(items[0].data.reason).toBe("Atraso no caixa");
  });

  it("deve executar remover_penalidade e deletar o item da persistência", async () => {
    // 1. Cria item prévio
    const item = await persistenceStore.pushItem("ws_101", "penalidades_vendedor", 42, {
      value: 30,
      reason: "Uniforme",
    });

    // 2. Executa a ação de remoção
    const result = await ActionExecutor.execute({
      recipe: mockRecipe,
      actionId: "remover_penalidade",
      row: { vendedor_id: 42, penalidade_id: item.id },
      formData: { __confirmed: true },
      workspaceId: "ws_101",
      workspaceVersion: 5,
      persistenceStore,
    });

    expect(result.success).toBe(true);
    expect(result.newWorkspaceVersion).toBe(6);
    expect(result.effects).toContainEqual({
      type: "toast",
      variant: "success",
      message: "Penalidade removida!",
    });

    // Verifica se foi removido
    const items = await persistenceStore.getItems("ws_101", "penalidades_vendedor", 42);
    expect(items).toHaveLength(0);
  });
});
