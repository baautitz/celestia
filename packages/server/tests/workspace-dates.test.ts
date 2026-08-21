import { describe, it, expect, beforeEach } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { MockSourceConnector } from "../src/data/source-connector.js";
import { MemoryPersistenceStore } from "../src/data/persistence-store.js";
import { WorkspaceValidator } from "../src/engine/workspace-validator.js";
import fechamentoRecipe from "../../../recipes/fechamento-mes.recipe.js";

describe("Validação de Datas da Área de Trabalho (Workspace Dates)", () => {
  let app: ReturnType<typeof createPlatformApp>;

  beforeEach(() => {
    app = createPlatformApp({
      sourceConnector: new MockSourceConnector({
        default: [{ vendedor_id: 1, vendedor: "Carlos", venda_geral: 5000 }],
      }),
      persistenceStore: new MemoryPersistenceStore(),
      recipes: {
        fechamento_mes: fechamentoRecipe,
      },
    });
  });

  // ─── 1. TESTES UNITÁRIOS DO WORKSPACE VALIDATOR ────────────────────────────
  describe("1. WorkspaceValidator.validateDates", () => {
    it("deve aceitar intervalo válido com data final posterior à data inicial", () => {
      const result = WorkspaceValidator.validateDates("2026-01-01", "2026-01-31");
      expect(result.startDate).toBe("2026-01-01");
      expect(result.endDate).toBe("2026-01-31");
    });

    it("deve aceitar mesmo dia (data final igual à data inicial)", () => {
      const result = WorkspaceValidator.validateDates("2026-01-15", "2026-01-15");
      expect(result.startDate).toBe("2026-01-15");
      expect(result.endDate).toBe("2026-01-15");
    });

    it("deve lançar erro quando a data final for anterior à data inicial", () => {
      expect(() => {
        WorkspaceValidator.validateDates("2026-01-31", "2026-01-01");
      }).toThrow("A Data Final não pode ser anterior à Data Inicial.");
    });

    it("deve lançar erro quando a data inicial for omitida ou vazia", () => {
      expect(() => {
        WorkspaceValidator.validateDates(undefined, "2026-01-31");
      }).toThrow("A Data Inicial é obrigatória para a Área de Trabalho.");
    });

    it("deve lançar erro quando a data final for omitida ou vazia", () => {
      expect(() => {
        WorkspaceValidator.validateDates("2026-01-01", undefined);
      }).toThrow("A Data Final é obrigatória para a Área de Trabalho.");
    });
  });

  // ─── 2. TESTES DE INTEGRAÇÃO NA API ────────────────────────────────────────
  describe("2. Proteção na Rota de Dados da API", () => {
    it("deve rejeitar com 400 Bad Request se a query enviar data final anterior à data inicial", async () => {
      const res = await app.request(
        "/api/workspaces/ws_teste/data/tabela_vendedores?recipe_id=fechamento_mes&start_date=2026-01-31&end_date=2026-01-01"
      );

      expect(res.status).toBe(400);
    });

    it("deve responder 200 OK quando as datas forem válidas", async () => {
      const res = await app.request(
        "/api/workspaces/ws_teste/data/tabela_vendedores?recipe_id=fechamento_mes&start_date=2026-01-01&end_date=2026-01-31"
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as { type: string };
      expect(json.type).toBe("table");
    });
  });

  // ─── 3. TESTES DE CICLO DE VIDA (CRIAR, LISTAR, CONCLUIR E TRAVAR) ─────────
  describe("3. Ciclo de Vida e Trava de Workspaces", () => {
    it("deve listar workspaces cadastradas", async () => {
      const res = await app.request("/api/workspaces");
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<{ id: string; status: string }>;
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.some((w) => w.id === "ws_fechamento_jan_2026")).toBe(true);
    });

    it("deve criar uma nova workspace e retornar 201 Created", async () => {
      const res = await app.request("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipeId: "fechamento_mes",
          name: "Fechamento Março/2026",
          startDate: "2026-03-01",
          endDate: "2026-03-31",
        }),
      });

      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: string; status: string; name: string };
      expect(created.status).toBe("open");
      expect(created.name).toBe("Fechamento Março/2026");
    });

    it("deve concluir uma workspace, bloquear actions de mutação, permitir actions de leitura e reabrir", async () => {
      // 1. Conclui a workspace
      const concludeRes = await app.request("/api/workspaces/ws_fechamento_jan_2026/conclude", {
        method: "POST",
      });
      expect(concludeRes.status).toBe(200);
      const concludeJson = (await concludeRes.json()) as { success: boolean; workspace: { status: string } };
      expect(concludeJson.success).toBe(true);
      expect(concludeJson.workspace.status).toBe("closed");

      // 2. Action de LEITURA (nature: 'read' - Ver Penalidades) DEVE ser permitida mesmo concluída
      const readActionRes = await app.request("/api/workspaces/ws_fechamento_jan_2026/actions/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe_id: "fechamento_mes",
          action_id: "visualizar_penalidades",
          row: { vendedor_id: 1, vendedor: "Carlos" },
        }),
      });
      expect(readActionRes.status).toBe(200);
      const readActionJson = (await readActionRes.json()) as { effects: Array<{ type: string }> };
      expect(readActionJson.effects.some((e) => e.type === "show_table")).toBe(true);

      // 3. Action de MUTAÇÃO (nature: 'mutation' - Adicionar Penalidade) DEVE ser rejeitada com 400
      const mutationActionRes = await app.request("/api/workspaces/ws_fechamento_jan_2026/actions/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe_id: "fechamento_mes",
          action_id: "adicionar_penalidade",
          row: { vendedor_id: 1, vendedor: "Carlos" },
          form_data: { valor: 10, reason: "Atraso" },
        }),
      });

      expect(mutationActionRes.status).toBe(400);
      const errJson = (await mutationActionRes.json()) as { error: string };
      expect(errJson.error).toContain("concluída e bloqueada para ações de modificação");

      // 4. Reabre a workspace
      const reopenRes = await app.request("/api/workspaces/ws_fechamento_jan_2026/reopen", {
        method: "POST",
      });
      expect(reopenRes.status).toBe(200);
      const reopenJson = (await reopenRes.json()) as { success: boolean; workspace: { status: string } };
      expect(reopenJson.success).toBe(true);
      expect(reopenJson.workspace.status).toBe("open");
    });
  });
});
