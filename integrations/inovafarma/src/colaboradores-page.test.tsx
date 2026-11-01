// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ColaboradoresPage } from "./colaboradores-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", () => ({ apiFetch }));

const lista = {
  colaboradores: [
    { codigoColaborador: 7, nome: "ANA SOUZA", ativo: true },
    { codigoColaborador: 9, nome: "BRUNO LIMA", ativo: false },
  ],
};

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ColaboradoresPage", () => {
  it("abre só nos ativos, com Cód. e nome", async () => {
    apiFetch.mockResolvedValue(lista);
    render(<ColaboradoresPage />);
    expect(await screen.findByText("ANA SOUZA")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.queryByText("BRUNO LIMA")).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith("/api/m/inovafarma/colaboradores");
  });

  it("mostra todos pelo filtro de situação", async () => {
    apiFetch.mockResolvedValue(lista);
    render(<ColaboradoresPage />);
    await screen.findByText("ANA SOUZA");
    fireEvent.click(screen.getByRole("combobox", { name: "Situação" }));
    const todos = await screen.findByRole("option", { name: "Todos" });
    // O Select só aceita o clique em um item destacado, e o destaque vem do movimento do mouse.
    fireEvent.mouseMove(todos);
    fireEvent.click(todos);
    expect(await screen.findByText("BRUNO LIMA")).toBeTruthy();
    expect(screen.getByText("ANA SOUZA")).toBeTruthy();
  });

  it("mostra o erro em vez de lista vazia e recarrega com Tentar novamente", async () => {
    apiFetch.mockRejectedValueOnce(new Error("ERP InovaFarma indisponível."));
    render(<ColaboradoresPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("ERP InovaFarma indisponível.");
    expect(screen.queryByText("Nenhum Colaborador encontrado.")).toBeNull();

    apiFetch.mockResolvedValueOnce(lista);
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("ANA SOUZA")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
