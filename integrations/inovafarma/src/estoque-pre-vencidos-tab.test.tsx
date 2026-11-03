// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { HeaderActionsProvider, useHeaderActions } from "@platform/ui/context/header-actions";
import { PreVencidosPage } from "./pre-vencidos-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const produto = { id: "guid-1", nome: "DIPIRONA 500MG", codigoBarra: "7891234567895" };
const item = (extra: Record<string, unknown> = {}) => ({
  id: "ipv_1",
  codigoLoja: 1,
  produtoId: produto.id,
  nomeProduto: produto.nome,
  codigoBarra: produto.codigoBarra,
  validade: "2027-06",
  quantidade: 3,
  restante: 3,
  incluidoEm: "2027-04-10T13:00:00.000Z",
  version: 1,
  ...extra,
});
let contexto: Record<string, unknown> = {};
const contextoEstoque = { podeLancar: false, podeConferir: false, podeEstoque: true, vinculado: true, periodos: [], lojas: [], lojasEstoque: [{ codigo: 1, nome: "Centro" }] };
let itens: Record<string, unknown>[] = [];

/** Dia local a `dias` de hoje, `AAAA-MM-DD`. */
const dia = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ddmmaaaa = (iso: string) => iso.split("-").reverse().join("");

beforeEach(() => {
  itens = [item()];
  contexto = contextoEstoque;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/contexto")) return contexto;
    if (url.includes("/produtos")) return [produto];
    if (init?.method === "POST") {
      const novo = item({ id: "ipv_2", quantidade: 5, restante: 5, validade: "2027-08" });
      itens = [...itens, novo];
      return novo;
    }
    if (init?.method === "PUT") {
      const editado = item({ quantidade: 7, restante: 7, version: 2 });
      itens = [editado];
      return editado;
    }
    return itens;
  });
});
afterEach(cleanup);

/** Destino das ações do cabeçalho, que no app é o shell. */
const HeaderSlot = () => <>{useHeaderActions().actions}</>;
const renderizar = () =>
  render(
    <UiProvider>
      <HeaderActionsProvider>
        <HeaderSlot />
        <PreVencidosPage />
      </HeaderActionsProvider>
    </UiProvider>,
    { wrapper: MemoryRouter },
  );

describe("aba Estoque", () => {
  it("lista os Itens da Loja do Vínculo com validade, quantidade e data de inclusão", async () => {
    renderizar();
    expect(await screen.findByRole("tab", { name: "Estoque" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Loja" }).textContent).toContain("Centro");
    expect(await screen.findByRole("cell", { name: "DIPIRONA 500MG" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "06/2027" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "10/04/2027" })).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("/pre-vencidos/estoque/itens?codigoLoja=1"));
  });

  it("mostra o Restante e traz os Itens zerados só pelo filtro", async () => {
    renderizar();
    await screen.findByRole("cell", { name: "DIPIRONA 500MG" });
    expect(screen.getByRole("columnheader", { name: /Restante/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Mostrar Itens zerados" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("/pre-vencidos/estoque/itens?codigoLoja=1&zerados=true")));
  });

  it("inclui um Item em janela, enviando o identificador opaco do produto, e a lista volta do servidor", async () => {
    renderizar();
    await screen.findByRole("cell", { name: "DIPIRONA 500MG" });
    fireEvent.click(screen.getByRole("button", { name: "Incluir Item" }));
    const campo = (await screen.findByLabelText("Produto (bipe o código de barras ou digite o nome)")) as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "7891234567895" } });
    await waitFor(() => expect(campo.value).toContain("DIPIRONA 500MG"));
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "5" } });
    fireEvent.change(screen.getByPlaceholderText("mm/aaaa"), { target: { value: "082027" } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir" }));
    expect(await screen.findByRole("cell", { name: "08/2027" })).toBeTruthy();
    const envio = apiFetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(envio![1].body)).toEqual({ codigoLoja: 1, produtoId: "guid-1", quantidade: 5, validade: "2027-08" });
  });

  it("edita quantidade e validade com a version do Item", async () => {
    renderizar();
    await screen.findByRole("cell", { name: "DIPIRONA 500MG" });
    fireEvent.click(screen.getByRole("button", { name: "Editar DIPIRONA 500MG" }));
    const quantidade = await screen.findByLabelText("Quantidade");
    fireEvent.change(quantidade, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(apiFetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const envio = apiFetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(envio![0]).toContain("/pre-vencidos/estoque/itens/ipv_1");
    expect(JSON.parse(envio![1].body)).toEqual({ quantidade: 7, validade: "2027-06", version: 1 });
  });

  it("sem a Permission de Baixas, a janela de inclusão não tem data de inclusão", async () => {
    renderizar();
    await screen.findByRole("cell", { name: "DIPIRONA 500MG" });
    fireEvent.click(screen.getByRole("button", { name: "Incluir Item" }));
    await screen.findByLabelText("Quantidade");
    expect(screen.queryByText("Data de inclusão")).toBeNull();
  });

  it("com a Permission de Baixas, inclui com data de inclusão retroativa até o início do Closing Period aberto", async () => {
    contexto = { ...contextoEstoque, podeBaixas: true, lojasBaixas: [{ codigo: 1, nome: "Centro" }], periodos: [{ id: "p1", name: "Atual", startDate: dia(-5), endDate: dia(10), status: "open" }] };
    renderizar();
    await screen.findByRole("cell", { name: "DIPIRONA 500MG" });
    fireEvent.click(screen.getByRole("button", { name: "Incluir Item" }));
    const campo = (await screen.findByLabelText("Produto (bipe o código de barras ou digite o nome)")) as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "7891234567895" } });
    await waitFor(() => expect(campo.value).toContain("DIPIRONA 500MG"));
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "5" } });
    fireEvent.change(screen.getByPlaceholderText("mm/aaaa"), { target: { value: "082027" } });
    expect(screen.getByText("Data de inclusão")).toBeTruthy();
    const data = screen.getByPlaceholderText("dd/mm/aaaa");

    fireEvent.change(data, { target: { value: ddmmaaaa(dia(-6)) } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir" }));
    expect(await screen.findByText(/não pode ser antes do início do Período aberto/)).toBeTruthy();
    expect(apiFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    fireEvent.change(data, { target: { value: ddmmaaaa(dia(-5)) } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir" }));
    await waitFor(() => expect(apiFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const envio = apiFetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(envio![1].body)).toEqual({ codigoLoja: 1, produtoId: "guid-1", quantidade: 5, validade: "2027-08", incluidoEm: dia(-5) });
  });
});
