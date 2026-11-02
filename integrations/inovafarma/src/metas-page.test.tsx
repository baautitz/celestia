// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { HeaderActionsProvider } from "@platform/ui/context/header-actions";
import { MetasPage } from "./metas-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const cmv = {
  id: "tme_1",
  nome: "CMV",
  indicador: "cmv",
  exibicao: "atingida",
  mostrarPremio: true,
  semAlvo: false,
  regra: { tipo: "faixas", faixas: [{ atingimento: 100, valorCentavos: 10000 }] },
  alvoPadrao: 30,
  ativo: true,
  version: 1,
  premio: "CMV % até 30% paga R$ 100,00",
};
const participantes = [
  { codigoColaborador: 1, nome: "ANA", alvo: 30 },
  { codigoColaborador: 2, nome: "BIA", alvo: null },
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
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") return { ...cmv, ...JSON.parse(String(init.body)), version: 2, premio: "CMV % até 28% paga R$ 100,00" };
    if (init?.method === "POST") return { metas: [] };
    if (url.endsWith("/aplicacao")) return { periodos: [{ id: "abril", name: "Abril", metaId: "met_1", version: 3, participantes }] };
    return [cmv];
  });
});
afterEach(cleanup);

const renderizar = () => render(<UiProvider><HeaderActionsProvider><MetasPage /></HeaderActionsProvider></UiProvider>);

describe("Metas: Tipos de Meta", () => {
  it("lista os Tipos de Meta com a prévia do Prêmio", async () => {
    renderizar();
    expect(await screen.findByRole("tab", { name: "Tipos de Meta" })).toBeTruthy();
    expect((await screen.findAllByText("CMV % até 30% paga R$ 100,00")).length).toBeGreaterThan(0);
  });

  it("ao mudar o Alvo padrão, aplica aos Participantes escolhidos", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: "Alterar Tipo de Meta CMV" }));
    const alvo = (await screen.findByLabelText(/Alvo padrão/)) as HTMLInputElement;
    expect(alvo.value).toBe("30");
    fireEvent.change(alvo, { target: { value: "28" } });
    expect(await screen.findByText("CMV % até 28% paga R$ 100,00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    fireEvent.click(await screen.findByRole("button", { name: "Desmarcar todos" }));
    fireEvent.click(screen.getByRole("switch", { name: "BIA" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/m/inovafarma/metas/tipos/tme_1/aplicar-alvo-padrao", expect.anything()));
    const [, init] = apiFetch.mock.calls.find(([url]) => String(url).endsWith("/aplicar-alvo-padrao"))!;
    expect(JSON.parse(String(init.body))).toEqual({ aplicacoes: [{ metaId: "met_1", version: 3, codigos: [2] }] });
  });
});
