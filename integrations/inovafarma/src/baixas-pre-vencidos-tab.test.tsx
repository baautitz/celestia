// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { HeaderActionsProvider } from "@platform/ui/context/header-actions";
import { PreVencidosPage } from "./pre-vencidos-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const periodos = [
  { id: "p-abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" },
  { id: "p-marco", name: "Março", startDate: "2027-03-01", endDate: "2027-03-31", status: "closed" },
];
const contexto = (extra: Record<string, unknown> = {}) => ({
  podeEstoque: false,
  podeBaixas: true,
  periodos,
  lojas: [{ codigo: 1, nome: "Centro" }],
  ...extra,
});
const grupos = [
  {
    codigoColaborador: 7,
    nomeColaborador: "ANA SOUZA",
    quantidade: 3,
    vendas: [
      { vendaId: 501, data: "2027-04-02 10:15:00", produtoId: "guid-1", nomeProduto: "DIPIRONA 500MG", codigoBarra: "789", quantidadeVendida: 2, quantidade: 2 },
      { vendaId: 502, data: "2027-04-03 11:00:00", produtoId: "guid-1", nomeProduto: "DIPIRONA 500MG", codigoBarra: "789", quantidadeVendida: 4, quantidade: 1 },
    ],
  },
];

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

const renderizar = () =>
  render(
    <UiProvider>
      <HeaderActionsProvider>
        <PreVencidosPage />
      </HeaderActionsProvider>
    </UiProvider>,
    { wrapper: MemoryRouter },
  );

describe("aba Baixas", () => {
  it("mostra as Baixas da Loja no Closing Period aberto, por Colaborador, e abre por venda", async () => {
    apiFetch.mockImplementation(async (url: string) => (url.endsWith("/contexto") ? contexto() : grupos));
    renderizar();
    expect(await screen.findByRole("tab", { name: "Baixas" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Estoque" })).toBeNull();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("/pre-vencidos/baixas?codigoLoja=1&periodoId=p-abril")));
    expect(await screen.findByRole("cell", { name: "ANA SOUZA" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expandir linha" }));
    expect(await screen.findByRole("cell", { name: "501" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "02/04/2027 10:15" })).toBeTruthy();
    expect(screen.getAllByRole("cell", { name: "DIPIRONA 500MG" })).toHaveLength(2);
  });

  it("sem Baixas no período, avisa", async () => {
    apiFetch.mockImplementation(async (url: string) => (url.endsWith("/contexto") ? contexto() : []));
    renderizar();
    expect(await screen.findByText("Nenhuma Baixa nesta Loja no período.")).toBeTruthy();
  });

  it("corrige a Baixa de uma venda em janela, com quantidade de zero até o vendido e motivo obrigatório", async () => {
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/contexto")) return contexto();
      if (init?.method === "POST") return { id: "cbx_1", quantidade: 1, motivo: "Uma não era", version: 1 };
      return grupos;
    });
    renderizar();
    await screen.findByRole("cell", { name: "ANA SOUZA" });
    fireEvent.click(screen.getByRole("button", { name: "Expandir linha" }));
    fireEvent.click(await screen.findByRole("button", { name: "Corrigir a Baixa da venda 501" }));
    const quantidade = (await screen.findByLabelText("Quantidade de Pré-vencido")) as HTMLInputElement;
    expect(quantidade.value).toBe("2");
    fireEvent.change(quantidade, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    expect(await screen.findByText("A quantidade vai de 0 até o que a venda teve (2).")).toBeTruthy();
    expect(await screen.findByText("Informe o motivo da Correção.")).toBeTruthy();
    fireEvent.change(quantidade, { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Uma não era" } });
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    await waitFor(() => expect(apiFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const envio = apiFetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(envio![0]).toContain("/pre-vencidos/baixas/correcoes");
    expect(JSON.parse(envio![1].body)).toEqual({ codigoLoja: 1, periodoId: "p-abril", vendaId: 501, produtoId: "guid-1", quantidade: 1, motivo: "Uma não era" });
    // A lista volta do servidor depois de salvar.
    await waitFor(() => expect(apiFetch.mock.calls.filter(([url]) => String(url).includes("/pre-vencidos/baixas?")).length).toBeGreaterThan(1));
  });

  it("mostra a Correção e o motivo, e desfaz a Correção pela version", async () => {
    const corrigidos = [{ ...grupos[0]!, vendas: [{ ...grupos[0]!.vendas[0]!, quantidade: 1, correcao: { id: "cbx_1", quantidade: 1, motivo: "Uma não era", autorNome: "Gil", version: 2 } }] }];
    apiFetch.mockImplementation(async (url: string) => (url.endsWith("/contexto") ? contexto() : corrigidos));
    renderizar();
    await screen.findByRole("cell", { name: "ANA SOUZA" });
    fireEvent.click(screen.getByRole("button", { name: "Expandir linha" }));
    expect(await screen.findByRole("cell", { name: "Uma não era (Gil)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desfazer a Correção da venda 501" }));
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("/pre-vencidos/baixas/correcoes/cbx_1?version=2"), { method: "DELETE" }));
  });

  it("no Período fechado, não corrige", async () => {
    apiFetch.mockImplementation(async (url: string) => (url.endsWith("/contexto") ? contexto({ periodos: [periodos[1]] }) : grupos));
    renderizar();
    await screen.findByRole("cell", { name: "ANA SOUZA" });
    fireEvent.click(screen.getByRole("button", { name: "Expandir linha" }));
    await screen.findByRole("cell", { name: "501" });
    expect(screen.queryByRole("button", { name: "Corrigir a Baixa da venda 501" })).toBeNull();
  });
});

