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

const contexto = {
  abas: { tipos: true, montar: true, acompanhamento: true, minhas: true },
  periodos: [{ id: "abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" }],
  lojas: [{ codigo: 10, nome: "Centro" }],
  visualizacoes: [{ id: "geral", lojas: [{ codigo: 10, nome: "Centro" }] }],
};
const acompanhamento = {
  congelada: false,
  apuradoEm: "2027-04-15T00:00:00.000Z",
  linhas: [
    {
      metaId: "met_1",
      tipo: { ...cmv, premio: cmv.premio },
      codigoColaborador: 1,
      nome: "ANA",
      alvo: 30,
      realizado: 25,
      atingimento: 120,
      atingida: true,
      premioCentavos: 10000,
      resultado: "CMV 25% · Meta: até 30% · ✓ 5 p.p. abaixo",
    },
  ],
  totais: [{ codigoColaborador: 1, nome: "ANA", premioCentavos: 10000 }],
};
const minhas = {
  congelada: false,
  metas: [
    { metaId: "met_1", nome: "CMV", exibicao: "atingida", atingida: true, premioCentavos: 10000 },
    { metaId: "met_2", nome: "Ticket", exibicao: "progresso", atingida: false, realizado: "R$ 100,00", alvo: "R$ 120,00", falta: "R$ 20,00" },
    { metaId: "met_3", nome: "Lista", exibicao: "contagem", atingida: false, contagem: "19/20 produtos" },
  ],
};
const metaCmv = { id: "met_1", periodoId: "abril", tipoId: "tme_1", participantes, excluidos: [], lista: null, version: 1, tipo: cmv, pendentes: 1 };
const montagem = {
  somenteLeitura: false,
  copiadoDe: null,
  colaboradores: [
    { codigoColaborador: 1, nome: "ANA", ativo: true, lojas: [10] },
    { codigoColaborador: 2, nome: "BIA", ativo: true, lojas: [] },
  ],
  metas: [metaCmv],
  tiposDisponiveis: [],
};

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
    if (url.endsWith("/metas/contexto")) return contexto;
    if (url.includes("/metas/acompanhamento?")) return acompanhamento;
    if (url.includes("/metas/minhas?")) return minhas;
    if (url.includes("/metas?periodoId=")) return montagem;
    if (url.endsWith("/participantes/2")) return { ...metaCmv, participantes: [participantes[0]], excluidos: [2], version: 2 };
    if (url.endsWith("/definir-alvo")) return metaCmv;
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

describe("Metas: Montar Metas", () => {
  const abrir = async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Montar Metas" }));
    // Cada Meta é uma linha que expande para os Participantes.
    fireEvent.click(await screen.findByRole("button", { name: "CMV" }));
    return screen.findByRole("switch", { name: "BIA participa da Meta CMV" });
  };

  it("mostra os Participantes com o Alvo e desmarca quem não participa", async () => {
    const bia = await abrir();
    expect(screen.getAllByText("Pendente").length).toBeGreaterThan(0);
    fireEvent.click(bia);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/m/inovafarma/metas/met_1/participantes/2", expect.anything()));
    const [, init] = apiFetch.mock.calls.find(([url]) => String(url).endsWith("/participantes/2"))!;
    expect(JSON.parse(String(init.body))).toEqual({ version: 1, participa: false });
  });

  it("define o mesmo Alvo para os Participantes marcados", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Definir Alvo" }));
    fireEvent.change(await screen.findByLabelText("Alvo (em %)"), { target: { value: "27,5" } });
    fireEvent.click(screen.getByRole("switch", { name: "ANA" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/m/inovafarma/metas/met_1/definir-alvo", expect.anything()));
    const [, init] = apiFetch.mock.calls.find(([url]) => String(url).endsWith("/definir-alvo"))!;
    expect(JSON.parse(String(init.body))).toEqual({ version: 1, codigos: [2], alvo: 27.5 });
  });
});

describe("Metas: Acompanhamento", () => {
  it("mostra o resultado em palavras, o Atingimento e o Prêmio, filtrando pela Loja", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Acompanhamento" }));
    expect((await screen.findAllByText("CMV 25% · Meta: até 30% · ✓ 5 p.p. abaixo")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("120,0%").length).toBeGreaterThan(0);
    expect(apiFetch).toHaveBeenCalledWith("/api/m/inovafarma/metas/acompanhamento?periodoId=abril&visualizacao=geral");
    expect(screen.getAllByRole("button", { name: /Imprimir/ }).length).toBeGreaterThan(0);
  });
});

describe("Metas: Minhas Metas", () => {
  it("mostra cada Meta na Exibição que o servidor liberou", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Minhas Metas" }));
    expect((await screen.findAllByText("Realizado R$ 100,00 de R$ 120,00 · faltam R$ 20,00")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("19/20 produtos").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Atingida").length).toBeGreaterThan(0);
    expect(apiFetch).toHaveBeenCalledWith("/api/m/inovafarma/metas/minhas?periodoId=abril");
    expect(screen.queryByRole("button", { name: /Imprimir/ })).toBeNull();
  });
});
