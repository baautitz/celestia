// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { PedidosPage } from "./pedidos-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const contexto = {
  hoje: "2027-04-10",
  ontem: "2027-04-09",
  lojas: [{ codigo: 1, nome: "Centro" }],
  laboratorios: [{ id: "7", nome: "EMS" }],
  grupos: [{ id: "3", nome: "MEDICAMENTOS" }],
  secoes: [{ id: "9", nome: "GENERICOS" }],
};
const dipirona = { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", vendida: 5, estoque: 10, lojas: [{ codigoLoja: 1, vendida: 5, estoque: 10 }] };
const aas = { produtoId: "p-2", nome: "AAS", codigoBarra: null, vendida: 1, estoque: 4, lojas: [{ codigoLoja: 1, vendida: 1, estoque: 4 }] };
let produtos: unknown[];

beforeEach(() => {
  produtos = [dipirona, aas];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/contexto")) return contexto;
    if (url.includes("/movimentacao")) return [{ mes: "2027-03", vendida: 12, comprada: 30 }];
    return produtos;
  });
});
afterEach(cleanup);

const renderizar = () => render(<UiProvider><PedidosPage /></UiProvider>, { wrapper: MemoryRouter });

describe("Pedidos: Lançamento", () => {
  it("abre com o dia anterior e sem outros filtros", async () => {
    renderizar();
    expect(await screen.findByLabelText("Selecionar DIPIRONA")).toBeDefined();
    const url = String(apiFetch.mock.calls.map((c) => c[0]).find((u: string) => u.includes("/produtos")));
    expect(url).toContain("modo=periodo");
    expect(url).toContain("de=2027-04-09");
    expect(url).toContain("ate=2027-04-09");
    expect(url).not.toContain("lojas=");
    expect(url).not.toContain("grupo=");
  });

  it("ao marcar um produto mostra as Lojas e a movimentação mensal", async () => {
    renderizar();
    fireEvent.click(await screen.findByLabelText("Selecionar DIPIRONA"));
    expect(await screen.findByText("Lojas: DIPIRONA")).toBeDefined();
    expect(await screen.findByText("03/2027")).toBeDefined();
    expect(screen.getByText("1 produto selecionado")).toBeDefined();
  });

  it("mantém a seleção quando a busca tira o produto da grade", async () => {
    renderizar();
    fireEvent.click(await screen.findByLabelText("Selecionar DIPIRONA"));
    fireEvent.change(screen.getByPlaceholderText("Buscar produto"), { target: { value: "AAS" } });
    await waitFor(() => expect(screen.getByText("1 produto selecionado")).toBeDefined());
    expect(screen.getByText("Lojas: DIPIRONA")).toBeDefined();
  });
});
