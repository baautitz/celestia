// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PreVencidosPage } from "./pre-vencidos-page";
import { LancamentoWindow } from "./pre-vencido-window";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const feedback = vi.hoisted(() => ({ notify: vi.fn(), notifyError: vi.fn() }));
const windows = vi.hoisted(() => ({ confirm: vi.fn(), open: vi.fn() }));
vi.mock("@platform/ui/imperative/provider", () => ({ useUi: () => ({ feedback, windows }) }));
const janela = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@platform/ui/imperative/use-window", async (original) => ({
  ...(await original<typeof import("@platform/ui/imperative/use-window")>()),
  useWindow: () => janela,
  WindowActions: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  WindowCancelButton: () => null,
}));

const periodos = [
  { id: "p-abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" },
  { id: "p-marco", name: "Março", startDate: "2027-03-01", endDate: "2027-03-31", status: "open" },
];
const contexto = (extra: Record<string, unknown> = {}) => ({
  podeLancar: true,
  podeConferir: false,
  vinculado: true,
  periodos,
  lojas: [{ codigo: 1, nome: "Centro" }],
  ...extra,
});

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  apiFetch.mockReset();
  janela.resolve.mockReset();
});
afterEach(cleanup);

describe("Tela Pré-vencidos", () => {
  it("abre com o Closing Period aberto de data mais recente selecionado", async () => {
    apiFetch.mockImplementation(async (url: string) => (url.includes("/contexto") ? contexto() : []));
    render(<PreVencidosPage />);
    expect((await screen.findByRole("combobox", { name: "Período de Fechamento" })).textContent).toContain("Abril");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("/pre-vencidos/lancamentos?periodoId=p-abril")));
  });

  it("mostra a aba Conferência só para quem tem a Permission", async () => {
    apiFetch.mockImplementation(async (url: string) => (url.includes("/contexto") ? contexto({ podeLancar: false, podeConferir: true, periodosConferencia: periodos, lojasConferencia: [], colaboradores: [] }) : []));
    render(<PreVencidosPage />);
    await screen.findByRole("tab", { name: "Conferência" });
    expect(screen.queryByRole("tab", { name: "Meus Lançamentos" })).toBeNull();
  });

  it("avisa quem não tem Vínculo, em vez de oferecer o lançamento", async () => {
    apiFetch.mockImplementation(async (url: string) => (url.includes("/contexto") ? contexto({ vinculado: false, lojas: [] }) : []));
    render(<PreVencidosPage />);
    await screen.findByText(/não está vinculado a um Colaborador/);
    expect(screen.queryByRole("button", { name: "Novo lançamento" })).toBeNull();
  });
});

describe("Janela de lançamento", () => {
  it("já vem com a Loja selecionada quando o Colaborador tem uma só", () => {
    render(<LancamentoWindow periodoId="p-abril" lojas={[{ codigo: 1, nome: "Centro" }]} />);
    expect(screen.getByRole("combobox", { name: "Loja" }).textContent).toContain("Centro");
  });

  it("deixa a Loja para escolher quando há mais de uma", () => {
    render(<LancamentoWindow periodoId="p-abril" lojas={[{ codigo: 1, nome: "Centro" }, { codigo: 2, nome: "Bairro" }]} />);
    expect(screen.getByRole("combobox", { name: "Loja" }).textContent).not.toContain("Centro");
  });

  it("digitar ou bipar busca sozinho; com um único resultado o produto já fica escolhido, e o lançamento envia o identificador opaco", async () => {
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/produtos")) return [{ id: "guid-1", nome: "DIPIRONA 500MG", codigoBarra: "7891234567895" }];
      return { id: "pv_1", init };
    });
    render(<LancamentoWindow periodoId="p-abril" lojas={[{ codigo: 1, nome: "Centro" }]} />);
    const campo = screen.getByLabelText("Produto (bipe o código de barras ou digite o nome)") as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "7891234567895" } });
    await waitFor(() => expect(campo.value).toContain("DIPIRONA 500MG"));
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "3" } });
    fireEvent.change(screen.getByPlaceholderText("mm/aaaa"), { target: { value: "062027" } });
    fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
    await waitFor(() => expect(janela.resolve).toHaveBeenCalled());
    const envio = apiFetch.mock.calls.find(([url]) => String(url).endsWith("/pre-vencidos/lancamentos"));
    expect(JSON.parse(envio![1].body)).toEqual({ periodoId: "p-abril", codigoLoja: 1, produtoId: "guid-1", quantidade: 3, validade: "2027-06" });
    expect(within(document.body).queryByText("987654")).toBeNull();
  });
});
