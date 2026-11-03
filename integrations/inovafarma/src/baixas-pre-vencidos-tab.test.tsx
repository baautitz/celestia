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
  lojasBaixas: [{ codigo: 1, nome: "Centro" }],
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
});
