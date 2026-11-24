// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HeaderActionsProvider } from "@platform/ui/context/header-actions";
import { UiProvider } from "@platform/ui/imperative/provider";
import { PedidosPage } from "./pedidos-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const contexto = { hoje: "2027-04-10", ontem: "2027-04-09", lojas: [{ codigo: 1, nome: "Centro" }, { codigo: 2, nome: "Norte" }] };
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
    if (url.includes("/pedidos/fornecedores")) return [{ codigo: 7, nome: "DISTRIBUIDORA SETE" }];
    if (url.includes("/movimentacao")) return [];
    if (url.includes("/pedidos/lancamento/ultimas-compras")) return [];
    if (url.includes("/pedidos/lancamento/entradas")) return [{ produtoId: "p-1", codigoLoja: 1, codigoFornecedor: 7 }];
    if (url.includes("/pedidos/lancamento/produtos")) return [dipirona];
    if (url.endsWith("/pedidos/pedidos") && init?.method === "POST") return { ...rascunho, version: 1 };
    if (url.endsWith("/pedidos/pedidos")) return [rascunho];
    return { ...rascunho, version: 2 };
  });
});
afterEach(cleanup);

const renderizar = () => render(<UiProvider><HeaderActionsProvider><PedidosPage /></HeaderActionsProvider></UiProvider>, { wrapper: MemoryRouter });
const chamadas = (metodo: string) => apiFetch.mock.calls.filter(([, init]) => init?.method === metodo);

describe("Pedido em rascunho", () => {
  it("gera o Pedido a partir dos produtos marcados, com a quantidade digitada por Loja", async () => {
    renderizar();
    const gerar = await screen.findByRole("button", { name: "Gerar pedido" });
    expect((gerar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByLabelText("Selecionar DIPIRONA"));
    fireEvent.change(await screen.findByLabelText("Quantidade a pedir da Loja Centro"), { target: { value: "12" } });
    fireEvent.blur(screen.getByLabelText("Quantidade a pedir da Loja Centro"));
    fireEvent.click(screen.getByRole("button", { name: "Remover a Loja Norte" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar pedido" }));
    await waitFor(() => expect(chamadas("POST")).toHaveLength(1));
    const [url, init] = chamadas("POST")[0] as [string, RequestInit];
    expect(url).toBe("/api/m/inovafarma/pedidos/pedidos");
    expect(JSON.parse(String(init.body))).toEqual({
      itens: [{ produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", quantidades: [{ codigoLoja: 1, quantidade: 12, codigosFornecedor: [7] }] }],
    });
  });

  it("digitar a quantidade a pedir na grade de Lojas marca o produto e preenche o rascunho", async () => {
    renderizar();
    const caixa = (await screen.findByLabelText("Selecionar DIPIRONA")) as HTMLInputElement;
    fireEvent.click(await screen.findByText("DIPIRONA"));
    const campo = await screen.findByLabelText("Quantidade a pedir da Loja Centro");
    fireEvent.change(campo, { target: { value: "5" } });
    fireEvent.blur(campo);
    await waitFor(() => expect(screen.getByLabelText("Selecionar DIPIRONA").getAttribute("aria-checked") ?? String(caixa.checked)).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Remover a Loja Norte" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar pedido" }));
    await waitFor(() => expect(chamadas("POST")).toHaveLength(1));
    expect(JSON.parse(String((chamadas("POST")[0] as [string, RequestInit])[1].body)).itens[0].quantidades[0]).toMatchObject({ codigoLoja: 1, quantidade: 5 });
  });

  it("a janela das distribuidoras da Loja já traz a que deu entrada no produto, e o rascunho a leva", async () => {
    renderizar();
    fireEvent.click(await screen.findByText("DIPIRONA"));
    fireEvent.click(await screen.findByRole("button", { name: "Distribuidoras da Loja Centro" }));
    const janela = await screen.findByRole("dialog");
    expect(await within(janela).findByText("DISTRIBUIDORA SETE")).toBeDefined();
    fireEvent.click(within(janela).getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Distribuidoras da Loja Centro" }).textContent).toBe("DISTRIBUIDORA SETE"));
    fireEvent.change(screen.getByLabelText("Quantidade a pedir da Loja Centro"), { target: { value: "4" } });
    fireEvent.blur(screen.getByLabelText("Quantidade a pedir da Loja Centro"));
    fireEvent.click(screen.getByRole("button", { name: "Remover a Loja Norte" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar pedido" }));
    await waitFor(() => expect(chamadas("POST")).toHaveLength(1));
    const [, init] = chamadas("POST")[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).itens[0].quantidades[0]).toEqual({ codigoLoja: 1, quantidade: 4, codigosFornecedor: [7] });
  });

  it("não gera com Loja em zero: abre o Lançamento só com o que falta, e salvar de novo confere outra vez", async () => {
    renderizar();
    fireEvent.click(await screen.findByLabelText("Selecionar DIPIRONA"));
    fireEvent.change(await screen.findByLabelText("Quantidade a pedir da Loja Centro"), { target: { value: "12" } });
    fireEvent.blur(screen.getByLabelText("Quantidade a pedir da Loja Centro"));
    fireEvent.click(screen.getByRole("button", { name: "Gerar pedido" }));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Completar o Pedido")).toBeDefined();
    // Só a Loja que falta; a Centro já tem quantidade e fica fora.
    expect(within(janela).queryByLabelText("Quantidade a pedir da Loja Centro")).toBeNull();
    fireEvent.click(within(janela).getByText("DIPIRONA"));
    fireEvent.click(await within(janela).findByRole("button", { name: "Remover a Loja Norte" }));
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.queryByText("Completar o Pedido")).toBeNull());
    expect(chamadas("POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Gerar pedido" }));
    await waitFor(() => expect(chamadas("POST")).toHaveLength(1));
    expect(JSON.parse(String((chamadas("POST")[0] as [string, RequestInit])[1].body)).itens[0].quantidades).toHaveLength(1);
  });

  it("lista os Pedidos, edita o rascunho com a versão e cancela depois de confirmar", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Pedidos" }));
    expect(await screen.findByText("Gil")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Editar Pedido de 10/04/2027" }));
    // A mesma tela do Lançamento, já com o que o rascunho tem.
    const janela = await screen.findByRole("dialog");
    const campo = await within(janela).findByLabelText("Quantidade a pedir da Loja Centro");
    await waitFor(() => expect((campo as HTMLInputElement).value).toBe("10"));
    fireEvent.change(campo, { target: { value: "7" } });
    fireEvent.blur(campo);
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(chamadas("PUT")).toHaveLength(1));
    const [url, init] = chamadas("PUT")[0] as [string, RequestInit];
    expect(url).toBe("/api/m/inovafarma/pedidos/pedidos/ped_1");
    const corpo = JSON.parse(String(init.body));
    expect(corpo.version).toBe(1);
    expect(corpo.itens[0].quantidades[0]).toMatchObject({ codigoLoja: 1, quantidade: 7 });

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar Pedido de 10/04/2027" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar Pedido" }));
    await waitFor(() => expect(chamadas("POST").some(([u]) => String(u).endsWith("/ped_1/cancelar"))).toBe(true));
    const cancelar = chamadas("POST").find(([u]) => String(u).endsWith("/ped_1/cancelar")) as [string, RequestInit];
    expect(JSON.parse(String(cancelar[1].body))).toEqual({ version: 1 });
  });
});
