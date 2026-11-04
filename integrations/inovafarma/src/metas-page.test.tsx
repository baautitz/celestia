// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { HeaderActionsProvider, useHeaderActions } from "@platform/ui/context/header-actions";
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
const preferencias: Record<string, string | null> = {};
const PREFERENCIAS_AGRUPADAS = { "inovafarma:montar-metas:view": "by-meta", "inovafarma:acompanhamento:view": "by-colaborador", "inovafarma:minhas-metas:view": "list" };
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
  ],
  baixas: [] as unknown[],
};
const metaCmv = { id: "met_1", periodoId: "abril", tipoId: "tme_1", participantes, excluidos: [], version: 1, tipo: cmv, pendentes: 1 };
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
  Object.assign(preferencias, PREFERENCIAS_AGRUPADAS);
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    // Visualização salva de cada aba: os testes agrupados usam a de antes da Tabela.
    if (url.startsWith("/api/iam/preferences/")) return { value: init?.method === "PUT" ? null : (preferencias[decodeURIComponent(url.split("/").pop()!)] ?? null) };
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

/** Destino das ações do cabeçalho, que no app é o shell. */
const HeaderSlot = () => <>{useHeaderActions().actions}</>;
const renderizar = () =>
  render(
    <UiProvider>
      <HeaderActionsProvider>
        <HeaderSlot />
        <MetasPage />
      </HeaderActionsProvider>
    </UiProvider>, { wrapper: MemoryRouter });

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

describe("Metas: construtor de Tipo de Meta", () => {
  const DIPIRONA = "8F14E45F-CEEA-467F-A8F4-5E1D2C3B4A01";
  const foco = { ...cmv, id: "tme_2", nome: "Foco", indicador: "incentivos-qtd", regra: { tipo: "proporcional", valorCentavos: 10000, gatilho: 80, teto: null }, alvoPadrao: 50, premio: "…" };
  const venda = { ...cmv, id: "tme_3", nome: "Venda", indicador: "venda-liquida", regra: { tipo: "fixo", valorCentavos: 10000 }, alvoPadrao: null, premio: "…" };
  const mix = {
    ...cmv,
    id: "tme_4",
    nome: "Mix",
    indicador: "lista-produtos",
    regra: { tipo: "fixo", valorCentavos: 10000 },
    alvoPadrao: 10,
    lista: {
      unidade: "unidades",
      entradas: [
        { tipo: "laboratorio", id: "414", nome: "EMS" },
        { tipo: "grupo", id: "44", nome: "Vitaminas" },
        { tipo: "produto", id: DIPIRONA, nome: "Dipirona 1g" },
      ],
    },
    premio: "…",
  };
  const comTipos = () => {
    const padrao = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/tipos-meta/lista/conferir")) return { ausentes: [{ tipo: "grupo", id: "44" }] };
      if (url.includes("/tipos-meta/lista/busca?tipo=secao")) return [{ tipo: "secao", id: "261", nome: "GENERICOS", detalhe: null }];
      if (url.endsWith("/metas/tipos") && !init) return [cmv, foco, venda, mix];
      return padrao(url, init);
    });
  };
  /** O Select só aceita o clique num item destacado, e o destaque vem do movimento do mouse. */
  const escolher = async (combobox: HTMLElement, opcao: string) => {
    fireEvent.click(combobox);
    const item = await screen.findByRole("option", { name: opcao });
    fireEvent.mouseMove(item);
    fireEvent.click(item);
  };
  const alterar = async (nome: string) => {
    comTipos();
    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: `Alterar Tipo de Meta ${nome}` }));
    return screen.findByRole("dialog");
  };

  it("abre num modal com O que mede e Como paga lado a lado e a Prévia do Prêmio embaixo", async () => {
    const modal = await alterar("CMV");
    expect(within(modal).getByText("O que mede")).toBeTruthy();
    expect(within(modal).getByText("Como paga")).toBeTruthy();
    expect(within(modal).getByText("Prévia do Prêmio")).toBeTruthy();
    expect((within(modal).getByLabelText("Alvo padrão (opcional)") as HTMLInputElement).value).toBe("30");
  });

  it("mostra embaixo do Gatilho o valor equivalente com o Alvo padrão", async () => {
    const modal = await alterar("Foco");
    expect(within(modal).getByText("= 40 incentivos com o Alvo padrão de 50")).toBeTruthy();
  });

  it("no Percentual do valor vendido, Calcular sobre começa no próprio Indicador em R$", async () => {
    const modal = await alterar("Venda");
    await escolher(within(modal).getByRole("combobox", { name: "Regra do Prêmio" }), "Percentual do valor vendido");
    expect((await within(modal).findByRole("combobox", { name: "Calcular sobre" })).textContent).toContain("Venda Líquida");
  });

  /** Abre a janela "Lista de Produtos" pelo botão "Montar Lista" do construtor. */
  const montarLista = async (construtor: HTMLElement) => {
    fireEvent.click(within(construtor).getByRole("button", { name: "Montar Lista" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    return screen.getAllByRole("dialog")[1]!;
  };

  it("em O que mede, resume a Lista em uma linha com as entradas fora do ERP", async () => {
    const modal = await alterar("Mix");
    expect(within(modal).getByText("1 Produto · 1 Grupo · 1 Laboratório")).toBeTruthy();
    expect(await within(modal).findByText("1 não encontrado no ERP")).toBeTruthy();
    expect(within(modal).queryByRole("row")).toBeNull();
  });

  it("monta a Lista por tipo e nome, com badge e o aviso de entrada fora do ERP, e busca no tipo escolhido", async () => {
    const construtor = await alterar("Mix");
    await within(construtor).findByText("1 não encontrado no ERP");
    const lista = await montarLista(construtor);
    expect(within(lista).getByRole("heading", { name: "Lista de Produtos" })).toBeTruthy();
    expect(document.activeElement).toBe(within(lista).getByPlaceholderText("Buscar Produto no ERP"));
    const linhas = () => within(lista).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(linhas()).toEqual([expect.stringContaining("ProdutoDipirona 1g"), expect.stringContaining("GrupoVitaminas"), expect.stringContaining("LaboratórioEMS")]);
    expect(within(lista).getAllByRole("row")[2]!.textContent).toContain("não encontrado no ERP");

    await escolher(within(lista).getByRole("combobox", { name: "Tipo da entrada" }), "Seção");
    fireEvent.input(within(lista).getByPlaceholderText("Buscar Seção no ERP"), { target: { value: "GEN" }, inputType: "insertText" });
    fireEvent.click(await screen.findByRole("option", { name: "GENERICOS" }));
    await waitFor(() => expect(linhas()).toContainEqual(expect.stringContaining("SeçãoGENERICOS")));
    expect(apiFetch).toHaveBeenCalledWith("/api/m/inovafarma/tipos-meta/lista/busca?tipo=secao&q=GEN");

    fireEvent.click(within(lista).getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    expect(within(construtor).getByText("1 Produto · 1 Grupo · 1 Seção · 1 Laboratório")).toBeTruthy();
  });

  it("Cancelar na Lista descarta as mudanças feitas nela", async () => {
    const construtor = await alterar("Mix");
    const lista = await montarLista(construtor);
    fireEvent.click(within(lista).getByRole("button", { name: "Remover Laboratório EMS" }));
    await waitFor(() => expect(within(lista).getAllByRole("row")).toHaveLength(3));
    fireEvent.click(within(lista).getByRole("button", { name: "Cancelar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    expect(within(construtor).getByText("1 Produto · 1 Grupo · 1 Laboratório")).toBeTruthy();
  });

  it("ao trocar a Lista de R$ para unidades com Sem Alvo ligado, volta a Regra e a Exibição de antes", async () => {
    const modal = await alterar("Mix");
    await escolher(within(modal).getByRole("combobox", { name: "A Lista mede" }), "Valor vendido (R$)");
    fireEvent.click(await within(modal).findByRole("switch", { name: "Sem Alvo (comissão pura)" }));
    await waitFor(() => expect(within(modal).getByRole("combobox", { name: "Regra do Prêmio" }).textContent).toContain("Percentual do valor vendido"));
    await escolher(within(modal).getByRole("combobox", { name: "A Lista mede" }), "Unidades vendidas");
    await waitFor(() => expect(within(modal).getByRole("combobox", { name: "Regra do Prêmio" }).textContent).toContain("Fixo se atingir"));
    expect(within(modal).getByRole("combobox", { name: "Exibição para o Colaborador" }).textContent).toContain("Atingida / Não atingida");
    expect(within(modal).queryByRole("switch", { name: "Sem Alvo (comissão pura)" })).toBeNull();
  });

  it("não deixa trocar a unidade da Lista quando o Tipo de Meta já tem Metas", async () => {
    const padrao = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) =>
      url.endsWith("/metas/tipos") && !init ? [{ ...mix, temMetas: true }] : padrao(url, init),
    );
    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: "Alterar Tipo de Meta Mix" }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByRole("combobox", { name: "A Lista mede" }).hasAttribute("data-disabled")).toBe(true);
    expect(within(modal).getByText("A unidade não muda: as Metas deste Tipo de Meta já têm Alvos nela.")).toBeTruthy();
  });

  it("Esc na busca da Lista fecha primeiro a busca, sem fechar o modal da Lista", async () => {
    const construtor = await alterar("Mix");
    const lista = await montarLista(construtor);
    await escolher(within(lista).getByRole("combobox", { name: "Tipo da entrada" }), "Seção");
    const busca = within(lista).getByPlaceholderText("Buscar Seção no ERP");
    fireEvent.input(busca, { target: { value: "GEN" }, inputType: "insertText" });
    expect(await screen.findByRole("option", { name: "GENERICOS" })).toBeTruthy();
    fireEvent.keyDown(busca, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("option", { name: "GENERICOS" })).toBeNull());
    expect(screen.getAllByRole("dialog")).toEqual([construtor, lista]);
    // Com a busca fechada, o próximo Esc fecha só o modal da Lista.
    fireEvent.keyDown(busca, { key: "Escape" });
    await waitFor(() => expect(screen.getAllByRole("dialog")).toEqual([construtor]));
  });

  it("mostra o problema que impede salvar ao lado do campo, e a ordem de O que mede", async () => {
    const modal = await alterar("Venda");
    const rotulos = within(modal).getAllByText(/^(Nome|Indicador|Sem Alvo \(comissão pura\)|Alvo padrão \(opcional\)|Exibição para o Colaborador|Mostrar o Prêmio ao Colaborador)$/);
    expect(rotulos.map((r) => r.textContent)).toEqual(["Nome", "Indicador", "Sem Alvo (comissão pura)", "Alvo padrão (opcional)", "Exibição para o Colaborador", "Mostrar o Prêmio ao Colaborador"]);
    await escolher(within(modal).getByRole("combobox", { name: "Regra do Prêmio" }), "Faixas em R$");
    fireEvent.click(within(modal).getByRole("button", { name: "Adicionar Faixa" }));
    fireEvent.change(within(modal).getByLabelText("% Atingido da Faixa 2"), { target: { value: "100" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Salvar" }));
    const erro = await waitFor(() => {
      const achado = within(modal).getAllByText("Duas Faixas não podem ter o mesmo % Atingido.").find((e) => e.getAttribute("role") === "alert");
      expect(achado).toBeTruthy();
      return achado!;
    });
    // Logo abaixo das Faixas, antes do botão de adicionar outra.
    expect(erro.nextElementSibling?.textContent).toContain("Adicionar Faixa");
  });
});

describe("Metas: Montar Metas na Tabela", () => {
  it("é a visualização padrão e digitar a Nova meta já liga o Participa", async () => {
    preferencias["inovafarma:montar-metas:view"] = null;
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Montar Metas" }));
    const bia = await screen.findByRole("switch", { name: "BIA participa da Meta CMV" });
    fireEvent.click(bia);
    expect(bia.getAttribute("aria-checked")).toBe("false");
    fireEvent.change(screen.getByRole("textbox", { name: /de BIA na Meta CMV/ }), { target: { value: "25" } });
    expect(bia.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Salvar alterações (1)" })).toBeTruthy();
    // A Tabela tem impressão, com a opção de de imprimir o Prêmio só onde o Colaborador o vê, marcada por padrão.
    fireEvent.click(screen.getByRole("button", { name: /Imprimir/ }));
    const soVisivel = await screen.findByRole("switch", { name: "Imprimir o Prêmio só das Metas que o mostram ao Colaborador" });
    expect(soVisivel.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    // Faixas em R$ têm vários valores: o Prêmio fica com o lápis.
    expect(screen.getByRole("button", { name: "Alterar o Prêmio de ANA na Meta CMV" })).toBeTruthy();
  });

  it("edita o Prêmio Fixo na própria célula e grava no Salvar alterações", async () => {
    preferencias["inovafarma:montar-metas:view"] = null;
    const padrao = apiFetch.getMockImplementation()!;
    const fixo = { ...metaCmv, tipo: { ...cmv, regra: { tipo: "fixo", valorCentavos: 10000 } } };
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) =>
      url.includes("/metas?periodoId=") ? { ...montagem, metas: [fixo] } : url.endsWith("/premio") ? fixo : padrao(url, init),
    );
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Montar Metas" }));
    const premio = await screen.findByRole("textbox", { name: "Prêmio de ANA na Meta CMV" });
    fireEvent.change(premio, { target: { value: "R$ 150,00" } });
    fireEvent.click(await screen.findByRole("button", { name: "Salvar alterações (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/m/inovafarma/metas/met_1/participantes/1/premio", expect.anything()));
    const [, init] = apiFetch.mock.calls.find(([url]) => String(url).endsWith("/participantes/1/premio"))!;
    expect(JSON.parse(String(init.body))).toEqual({ version: 1, premio: { tipo: "fixo", valorCentavos: 15000 } });
  });
});

describe("Metas: Definir Alvo fora do Por Meta", () => {
  it("na Tabela, o menu Definir Alvo abre a janela da Meta escolhida", async () => {
    preferencias["inovafarma:montar-metas:view"] = null;
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Montar Metas" }));
    fireEvent.click(await screen.findByRole("button", { name: "Definir Alvo" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "CMV" }));
    expect(await screen.findByText('Meta "CMV" · Abril')).toBeTruthy();
  });
});

describe("Metas: Montar Metas por Colaborador", () => {
  it("edita o Prêmio Fixo na linha expandida do Colaborador", async () => {
    preferencias["inovafarma:montar-metas:view"] = "by-colaborador";
    const padrao = apiFetch.getMockImplementation()!;
    const fixo = { ...metaCmv, tipo: { ...cmv, regra: { tipo: "fixo", valorCentavos: 10000 } } };
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) => (url.includes("/metas?periodoId=") ? { ...montagem, metas: [fixo] } : padrao(url, init)));
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Montar Metas" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Expandir linha" }))[0]!);
    fireEvent.change(await screen.findByRole("textbox", { name: "Prêmio de ANA na Meta CMV" }), { target: { value: "R$ 150,00" } });
    expect(await screen.findByRole("button", { name: "Salvar alterações (1)" })).toBeTruthy();
  });
});

describe("Metas: Montar Metas", () => {
  const abrir = async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Montar Metas" }));
    // Cada Meta é uma linha que expande para os Participantes.
    fireEvent.click((await screen.findAllByRole("button", { name: "Expandir linha" }))[0]!);
    return screen.findByRole("switch", { name: "BIA participa da Meta CMV" });
  };

  it("edita na linha e só grava depois do resumo de Salvar alterações", async () => {
    const bia = await abrir();
    fireEvent.click(bia);
    expect(apiFetch).not.toHaveBeenCalledWith("/api/m/inovafarma/metas/met_1/participantes/2", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações (1)" }));
    expect((await screen.findAllByText("Não participa")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
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
  it("mostra o resultado em palavras, o % Atingido e o Prêmio, filtrando pela Loja", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Acompanhamento" }));
    // Uma linha por Colaborador, já expandida com as Metas dele.
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
    expect(screen.getAllByText("Atingida").length).toBeGreaterThan(0);
    expect(apiFetch).toHaveBeenCalledWith("/api/m/inovafarma/metas/minhas?periodoId=abril");
    expect(screen.queryByRole("button", { name: /Imprimir/ })).toBeNull();
    expect(screen.queryByText("Minhas Baixas de Pré-vencido")).toBeNull();
  });

  it("mostra as Baixas de Pré-vencido do Colaborador no Período, por venda", async () => {
    minhas.baixas = [
      { vendaId: 101, data: "2026-04-03 10:15:00", produtoId: "p1", nomeProduto: "Dipirona 1g", codigoBarra: "789", quantidadeVendida: 3, quantidade: 2 },
      { vendaId: 102, data: "2026-04-04 10:15:00", produtoId: "p1", nomeProduto: "Dipirona 1g", codigoBarra: "789", quantidadeVendida: 2, quantidade: 0, correcao: { quantidade: 0, motivo: "Venda da prateleira comum" } },
    ];
    try {
      renderizar();
      fireEvent.click(await screen.findByRole("tab", { name: "Minhas Metas" }));
      expect((await screen.findAllByText("Minhas Baixas de Pré-vencido")).length).toBeGreaterThan(0);
      expect(screen.getAllByText("Dipirona 1g").length).toBeGreaterThan(0);
      expect(screen.getAllByText("03/04/2026 10:15").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Corrigida: Venda da prateleira comum").length).toBeGreaterThan(0);
    } finally {
      minhas.baixas = [];
    }
  });
});
