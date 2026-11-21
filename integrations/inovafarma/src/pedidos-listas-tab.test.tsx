// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { PedidosListasTab } from "./pedidos-listas-tab";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const vitaminas = { id: "plp_1", nome: "Vitaminas", entradas: [{ tipo: "grupo", id: "44", nome: "VITAMINAS" }], version: 3, criadoEm: "", atualizadoEm: "" };
const rascunho = { id: "plp_2", nome: "Zinco", entradas: [], version: 1, criadoEm: "", atualizadoEm: "" };

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === "DELETE" ? undefined : [vitaminas, rascunho]));
});
afterEach(cleanup);

const renderizar = () => render(<UiProvider><PedidosListasTab /></UiProvider>, { wrapper: MemoryRouter });

describe("Pedidos: Listas", () => {
  it("mostra as listas com a situação e o conteúdo", async () => {
    renderizar();
    expect(await screen.findByText("Vitaminas")).toBeDefined();
    expect(screen.getByText("Grupo VITAMINAS")).toBeDefined();
    expect(screen.getByText("Pronta")).toBeDefined();
    expect(screen.getByText("Em montagem")).toBeDefined();
  });

  it("exclui enviando a versão da lista", async () => {
    renderizar();
    fireEvent.click(await screen.findByLabelText("Excluir a lista Vitaminas"));
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/m/inovafarma/pedidos/listas/plp_1?version=3", { method: "DELETE" }));
  });

  it("cria uma lista com o nome informado", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar lista" }));
    fireEvent.change(await screen.findByLabelText("Nome da lista"), { target: { value: "Nova" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => c[1]?.method === "POST" && JSON.parse(c[1].body as string).nome === "Nova")).toBe(true));
  });
});
