// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { PreVencidosPage } from "./pre-vencidos-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const periodo = { id: "p-abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" };
const produto = { id: "guid-1", nome: "DIPIRONA 500MG", codigoBarra: "7891234567895" };
let lancamentos: Record<string, unknown>[] = [];

beforeEach(() => {
  lancamentos = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/contexto")) return { podeLancar: true, podeConferir: false, vinculado: true, periodos: [periodo], lojas: [{ codigo: 1, nome: "Centro" }] };
    if (url.includes("/produtos")) return [produto];
    if (init?.method === "POST") {
      const novo = { id: "pv_1", produtoId: produto.id, nomeProduto: produto.nome, codigoBarra: produto.codigoBarra, codigoLoja: 1, quantidade: 3, validade: "2027-06", version: 1, periodoId: periodo.id, nomeColaborador: "ANA" };
      lancamentos = [novo];
      return novo;
    }
    return lancamentos;
  });
});
afterEach(cleanup);

describe("lançar na tela", () => {
  it("depois de lançar, a tabela mostra o lançamento sem recarregar a página", async () => {
    render(
      <UiProvider>
        <PreVencidosPage />
      </UiProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Novo lançamento" }));
    const campo = (await screen.findByLabelText("Produto (bipe o código de barras ou digite o nome)")) as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "7891234567895" } });
    await waitFor(() => expect(campo.value).toContain("DIPIRONA 500MG"));
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "3" } });
    fireEvent.change(screen.getByPlaceholderText("mm/aaaa"), { target: { value: "062027" } });
    fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
    expect(await screen.findByRole("cell", { name: "DIPIRONA 500MG" })).toBeTruthy();
  });
});
