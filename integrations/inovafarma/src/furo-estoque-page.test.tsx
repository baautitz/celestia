// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { FuroEstoquePage } from "./furo-estoque-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const periodo = { id: "p-abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" };
const lojas = [{ codigo: 1, nome: "Centro" }];
const motivos = [{ id: "mot_vencido", nome: "Vencido", ativo: true, version: 1 }];
const ajuste = (codigoMovimento: number, totalCusto: number, justificativa: Record<string, unknown> | null) => ({
  codigoMovimento, codigoLoja: 1, data: "2027-04-10 15:36", operacao: "-", colaborador: "ANA SOUZA", usuario: "ANA",
  observacaoErp: `OBS ${codigoMovimento}`, quantidade: -1, totalCusto, itens: [], justificativa,
});
let contexto: Record<string, unknown>;

beforeEach(() => {
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
    return [ajuste(100, -50.5, null), ajuste(200, -9, { id: "jus_1", motivoId: "mot_vencido", motivo: "Vencido", observacao: null, version: 1, criadoEm: "", justificadoPor: "gil" })];
  });
});
afterEach(cleanup);

const renderizar = () => render(<UiProvider><FuroEstoquePage /></UiProvider>);

describe("Furo de Estoque", () => {
  it("abre nos não justificados e soma o furo", async () => {
    renderizar();
    expect(await screen.findByRole("button", { name: "Justificar Ajuste 100" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole("cell", { name: "200" })).toBeNull();
    expect(screen.queryByText(/OBS 100/)).toBeNull();
    expect(screen.getAllByText(/50,50/).length).toBeGreaterThan(0);
  });

  it("só mostra a aba Motivos com a Permission geral", async () => {
    contexto = { ...contexto, podeGerenciarMotivos: true };
    renderizar();
    expect(await screen.findByRole("tab", { name: "Motivos" })).toBeTruthy();
  });
});
