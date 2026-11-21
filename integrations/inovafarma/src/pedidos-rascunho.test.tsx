// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { PedidosPage } from "./pedidos-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const contexto = { hoje: "2027-04-10", ontem: "2027-04-09", lojas: [{ codigo: 1, nome: "Centro" }, { codigo: 2, nome: "Norte" }], laboratorios: [], grupos: [], secoes: [], listas: [] };
const dipirona = {
  produtoId: "p-1",
  nome: "DIPIRONA",
  codigoBarra: "789",
  vendida: 5,
  estoque: 10,
  lojas: [{ codigoLoja: 1, vendida: 3, estoque: 6 }, { codigoLoja: 2, vendida: 2, estoque: 4 }],
};
const rascunho = {
  id: "ped_1",
  status: "rascunho",
  itens: [{ produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", quantidades: [{ codigoLoja: 1, quantidade: 10 }] }],
  criadoPorId: "u1",
  criadoPorNome: "Gil",
  version: 1,
  criadoEm: "2027-04-10T12:00:00.000Z",
  atualizadoEm: "2027-04-10T12:00:00.000Z",
};

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/contexto")) return contexto;
    if (url.includes("/pedidos/visoes")) return [];
    if (url.includes("/movimentacao")) return [];
    if (url.includes("/pedidos/lancamento/produtos")) return [dipirona];
    if (url.endsWith("/pedidos/pedidos") && init?.method === "POST") return { ...rascunho, version: 1 };
    if (url.endsWith("/pedidos/pedidos")) return [rascunho];
    return { ...rascunho, version: 2 };
  });
});
afterEach(cleanup);

const renderizar = () => render(<UiProvider><PedidosPage /></UiProvider>, { wrapper: MemoryRouter });
const chamadas = (metodo: string) => apiFetch.mock.calls.filter(([, init]) => init?.method === metodo);

describe("Pedido em rascunho", () => {
  it("gera o Pedido a partir dos produtos marcados, com a quantidade digitada por Loja", async () => {
    renderizar();
    const gerar = await screen.findByRole("button", { name: "Gerar pedido" });
    expect((gerar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByLabelText("Selecionar DIPIRONA"));
    fireEvent.click(screen.getByRole("button", { name: "Gerar pedido" }));
    fireEvent.change(await screen.findByLabelText("DIPIRONA: Centro"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar rascunho" }));
    await waitFor(() => expect(chamadas("POST")).toHaveLength(1));
    const [url, init] = chamadas("POST")[0] as [string, RequestInit];
    expect(url).toBe("/api/m/inovafarma/pedidos/pedidos");
    expect(JSON.parse(String(init.body))).toEqual({
      itens: [{ produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", quantidades: [{ codigoLoja: 1, quantidade: 12 }, { codigoLoja: 2, quantidade: 0 }] }],
    });
  });

  it("lista os Pedidos, edita o rascunho com a versão e cancela depois de confirmar", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Pedidos" }));
    expect(await screen.findByText("Gil")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Editar Pedido de 10/04/2027" }));
    fireEvent.change(await screen.findByLabelText("DIPIRONA: Centro"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(chamadas("PUT")).toHaveLength(1));
    const [url, init] = chamadas("PUT")[0] as [string, RequestInit];
    expect(url).toBe("/api/m/inovafarma/pedidos/pedidos/ped_1");
    expect(JSON.parse(String(init.body))).toMatchObject({ version: 1, itens: [{ quantidades: [{ codigoLoja: 1, quantidade: 7 }] }] });

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar Pedido de 10/04/2027" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar Pedido" }));
    await waitFor(() => expect(chamadas("POST").some(([u]) => String(u).endsWith("/ped_1/cancelar"))).toBe(true));
    const cancelar = chamadas("POST").find(([u]) => String(u).endsWith("/ped_1/cancelar")) as [string, RequestInit];
    expect(JSON.parse(String(cancelar[1].body))).toEqual({ version: 1 });
  });
});
