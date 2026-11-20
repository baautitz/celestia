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
  it("avisa na tela quando o Usuário não pode ler os Períodos de Fechamento", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    apiFetch.mockImplementation(async (url: string) => {
      if (url === "/api/closing-periods") throw new ApiError("Sem permissão", 403);
      return { visualizacoes: [{ id: "geral", lojas: [] }] };
    });
    render(<UiProvider><VendasComissoesPage /></UiProvider>, { wrapper: MemoryRouter });
    expect(await screen.findByText(/Não foi possível carregar os Períodos de Fechamento: Sem permissão/)).toBeDefined();
    expect(screen.queryByText("Nenhum Período de Fechamento cadastrado na plataforma.")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
