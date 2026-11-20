// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { ApiError } from "@platform/ui/lib/api";
import { VendasComissoesPage } from "./web";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  apiFetch.mockReset();
});
afterEach(cleanup);

describe("Desempenho de Vendas", () => {
  it("lê os Períodos da rota do Desempenho, sem tocar em /api/closing-periods", async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/relatorios/vendas-colaborador/visualizacoes")) {
        return { periodos: [{ id: "p1", name: "Outubro", startDate: "2026-10-01", endDate: "2026-10-31", status: "open" }], visualizacoes: [{ id: "geral", lojas: [] }] };
      }
      return { resumo: null, colaboradores: [] };
    });
    render(<UiProvider><VendasComissoesPage /></UiProvider>, { wrapper: MemoryRouter });
    expect((await screen.findAllByText(/Outubro/)).length).toBeGreaterThan(0);
    expect(apiFetch.mock.calls.map(([url]) => url)).not.toContain("/api/closing-periods");
    expect(screen.queryByText(/Não foi possível carregar/)).toBeNull();
  });

  it("avisa na tela quando os Períodos e as Visualizações não carregam", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    apiFetch.mockRejectedValue(new ApiError("Sem permissão", 403));
    render(<UiProvider><VendasComissoesPage /></UiProvider>, { wrapper: MemoryRouter });
    expect(await screen.findByText(/Não foi possível carregar os Períodos de Fechamento e as Visualizações: Sem permissão/)).toBeDefined();
    expect(screen.queryByText("Nenhum Período de Fechamento cadastrado na plataforma.")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
