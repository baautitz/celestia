// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { FuroEstoquePage } from "./furo-estoque-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const periodo = { id: "p-abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" };
const lojas = [{ codigo: 1, nome: "Centro" }];
const motivos = [{ id: "mot_vencido", nome: "Vencido", ativo: true, version: 1 }];
const ajuste = (codigoMovimento: number, totalCusto: number, justificativa: Record<string, unknown> | null) => ({
  codigoMovimento, codigoLoja: 1, data: "2027-04-10 15:36", operacao: totalCusto < 0 ? "-" : "+", colaborador: "ANA SOUZA", usuario: "ANA",
  observacaoErp: `OBS ${codigoMovimento}`, quantidade: -1, totalCusto, itens: [], justificativa,
});
const justificado = { id: "jus_1", motivoId: "mot_vencido", motivo: "Vencido", observacao: null, version: 1, criadoEm: "", justificadoPor: "gil" };
let contexto: Record<string, unknown>;
let ajustes: ReturnType<typeof ajuste>[];

beforeEach(() => {
  ajustes = [ajuste(100, -50.5, null), ajuste(200, -9, justificado)];
  contexto = { todasAsLojas: false, podeGerenciarMotivos: false, periodos: [periodo], lojas, lojasGerenciadas: lojas, motivos };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/contexto")) return contexto;
    return ajustes;
  });
});
afterEach(cleanup);

const renderizar = () => render(<UiProvider><FuroEstoquePage /></UiProvider>, { wrapper: MemoryRouter });

describe("Furo de Estoque", () => {
  it("abre no Furo e soma só as saídas sem justificativa", async () => {
    renderizar();
    expect(await screen.findByRole("button", { name: "Justificar Ajuste 100" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole("cell", { name: "200" })).toBeNull();
    expect(screen.queryByText(/OBS 100/)).toBeNull();
    expect(screen.getAllByText(/50,50/).length).toBeGreaterThan(0);
  });

  it("uma entrada sem justificativa não abate o Furo e tem card próprio", async () => {
    ajustes = [ajuste(100, -500, null), ajuste(300, 500, null)];
    renderizar();
    const furo = await screen.findByRole("button", { name: "Furo" }, { timeout: 5000 });
    // Os cards aparecem antes dos Ajustes chegarem: espera os valores, em vez de lê-los na hora.
    expect(await within(furo.parentElement!).findByText("R$ 500,00")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Entradas não justificadas" }).parentElement!).getByText("R$ 500,00")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Justificar Ajuste 300" })).toBeNull();
  });

  it("o card escolhido filtra a tabela e clicar de novo mostra todos", async () => {
    ajustes = [ajuste(100, -50.5, null), ajuste(200, -9, justificado), ajuste(300, 20, null)];
    renderizar();
    const furo = await screen.findByRole("button", { name: "Furo" }, { timeout: 5000 });
    expect(furo.getAttribute("aria-pressed")).toBe("true");
    const justificados = screen.getByRole("button", { name: "Justificados" });
    // Os cards aparecem antes dos Ajustes chegarem: espera os valores, em vez de lê-los na hora.
    expect(await within(justificados.parentElement!).findByText("R$ 9,00")).toBeTruthy();
    expect(within(justificados.parentElement!).getByText("1 de 3 ajustes (33%)")).toBeTruthy();

    fireEvent.click(justificados);
    expect(await screen.findByRole("button", { name: "Alterar Justificativa do Ajuste 200" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Justificar Ajuste 100" })).toBeNull();

    fireEvent.click(justificados);
    expect(await screen.findByRole("button", { name: "Justificar Ajuste 300" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Justificar Ajuste 100" })).toBeTruthy();
  });

  it("o Ajuste justificado mostra um olho que abre a Justificativa", async () => {
    ajustes = [ajuste(200, -9, { ...justificado, observacao: "Quebrou na prateleira" })];
    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: "Justificados" }, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Ver Justificativa do Ajuste 200" }));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Vencido")).toBeTruthy();
    expect(within(janela).getByText("Quebrou na prateleira")).toBeTruthy();
    expect(within(janela).getByText("gil")).toBeTruthy();
  });

  it("a busca encontra o Ajuste pelo produto, por nome ou código de barras", async () => {
    const item = { produtoId: "p1", nome: "DIPIRONA 500MG", codigoBarra: "7891234567890", quantidade: 1, precoCusto: 9, totalCusto: 9 };
    ajustes = [{ ...ajuste(100, -9, null), itens: [item] }, ajuste(300, -5, null)];
    renderizar();
    expect(await screen.findByRole("button", { name: "Justificar Ajuste 300" }, { timeout: 5000 })).toBeTruthy();
    const busca = screen.getByPlaceholderText("Buscar Ajuste, Colaborador, Motivo ou produto");

    fireEvent.change(busca, { target: { value: "dipirona" } });
    expect(await screen.findByRole("button", { name: "Justificar Ajuste 100" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Justificar Ajuste 300" })).toBeNull();

    fireEvent.change(busca, { target: { value: "7891234567890" } });
    expect(await screen.findByRole("button", { name: "Justificar Ajuste 100" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Justificar Ajuste 300" })).toBeNull();
  });

  it("só mostra a aba Motivos com a Permission geral", async () => {
    contexto = { ...contexto, podeGerenciarMotivos: true };
    renderizar();
    expect(await screen.findByRole("tab", { name: "Motivos" })).toBeTruthy();
  });
});
