import { describe, it, expect, beforeEach } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { WorkspaceValidator } from "../src/engine/workspace-validator.js";
import { authHeader, createSeededUserStore, seededWorkspaces , withAuth } from "./helpers/fixtures.js";

describe("Validação de Datas da Área de Trabalho (Workspace Dates)", () => {
  let app: ReturnType<typeof createPlatformApp>;

  beforeEach(() => {
    app = createPlatformApp({
      userStore: createSeededUserStore(),
      workspaces: seededWorkspaces,
    });
    withAuth(app);
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

  // ─── 2. TESTES DE CICLO DE VIDA (CRIAR, LISTAR, CONCLUIR E TRAVAR) ─────────
  describe("3. Ciclo de Vida e Trava de Workspaces", () => {
    it("deve listar workspaces cadastradas", async () => {
      const res = await app.request("/api/workspaces", { headers: await authHeader(app) });
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

    it("deve rejeitar com 400 a criação com data final anterior à inicial", async () => {
      const res = await app.request("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Invertida", startDate: "2026-03-31", endDate: "2026-03-01" }),
      });
      expect(res.status).toBe(400);
    });

    it("deve rejeitar com 400 a edição que deixa data final anterior à inicial", async () => {
      const res = await app.request("/api/workspaces/ws_fechamento_jan_2026", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endDate: "2025-12-31" }),
      });
      expect(res.status).toBe(400);
    });

    it("deve concluir e reabrir uma workspace", async () => {
      // 1. Conclui a workspace
      const concludeRes = await app.request("/api/workspaces/ws_fechamento_jan_2026/conclude", {
        method: "POST",
      });
      expect(concludeRes.status).toBe(200);
      const concludeJson = (await concludeRes.json()) as { success: boolean; workspace: { status: string } };
      expect(concludeJson.success).toBe(true);
      expect(concludeJson.workspace.status).toBe("closed");

      // 2. Reabre a workspace
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
