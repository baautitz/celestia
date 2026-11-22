// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HeaderActionsProvider, useHeaderActions } from "@platform/ui/context/header-actions";
import { UiProvider } from "@platform/ui/imperative/provider";
import { PedidosPage } from "./pedidos-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const contexto = {
  hoje: "2027-04-10",
  ontem: "2027-04-09",
  lojas: [{ codigo: 1, nome: "Centro" }],
  podeEditarMinimos: true,
};
const visaoBase = { lojas: [1], entradas: [{ tipo: "laboratorio", id: "7", nome: "EMS" }], apenasComMinimo: false, usuarioId: "ana", version: 1 };
let visoes: unknown[];
const dipirona = { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", vendida: 5, estoque: 10, minimo: 0, sugestao: 0, aChegar: 0, lojas: [{ codigoLoja: 1, vendida: 5, estoque: 10, minimo: null, maximo: null, sugestao: 0, aChegar: 0, version: 0 }] };
const aas = { produtoId: "p-2", nome: "AAS", codigoBarra: null, vendida: 1, estoque: 4, minimo: 8, sugestao: 5, aChegar: 7, lojas: [{ codigoLoja: 1, vendida: 1, estoque: 4, minimo: 8, maximo: 20, sugestao: 5, aChegar: 7, version: 2 }] };
let produtos: unknown[];
let putResposta: Error | null = null;

beforeEach(() => {
  produtos = [dipirona, aas];
  putResposta = null;
  visoes = [];
  contextoAtual = contexto;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      if (putResposta) throw putResposta;
      const corpo = JSON.parse(init.body ?? "{}");
      return { codigoLoja: corpo.codigoLoja, minimo: corpo.minimo, maximo: corpo.maximo, version: corpo.version + 1 };
    }
    if (url.includes("/contexto")) return contextoAtual;
    if (url.includes("/pedidos/visoes")) return visoes;
    if (url.includes("/movimentacao")) return [{ mes: "2027-03", vendida: 12, comprada: 30 }];
    return produtos;
  });
});
afterEach(cleanup);

let contextoAtual = contexto;
const HeaderSlot = () => <>{useHeaderActions().actions}</>;
const renderizar = () =>
  render(
    <UiProvider>
      <HeaderActionsProvider>
        <HeaderSlot />
        <PedidosPage />
      </HeaderActionsProvider>
    </UiProvider>,
    { wrapper: MemoryRouter },
  );
/** Abre o sheet "Filtros" pelo botão do cabeçalho. */
const abrirFiltros = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Filtros" }));
  await screen.findByLabelText("Modo da data");
};

describe("Pedidos: Lançamento", () => {
  it("abre com o dia anterior e sem outros filtros", async () => {
    renderizar();
    expect(await screen.findByLabelText("Selecionar DIPIRONA")).toBeDefined();
    const url = String(apiFetch.mock.calls.map((c) => c[0]).find((u: string) => u.includes("/produtos")));
    expect(url).toContain("modo=apartir");
    expect(url).toContain("de=2027-04-09");
    expect(url).not.toContain("ate=");
    expect(url).not.toContain("lojas=");
    expect(url).not.toContain("grupo=");
  });

  it("o cursor começa na primeira linha e as Lojas e a movimentação seguem o cursor, não os marcados", async () => {
    renderizar();
    expect(await screen.findByText("Lojas: DIPIRONA")).toBeDefined();
    expect(await screen.findByText("03/2027")).toBeDefined();
    fireEvent.click(await screen.findByLabelText("Selecionar AAS"));
    expect(screen.getByText("1 produto selecionado")).toBeDefined();
    expect(screen.getByText("Lojas: DIPIRONA")).toBeDefined();
  });

  it("as setas movem o cursor da grade e o Espaço marca e desmarca a linha ativa", async () => {
    renderizar();
    await screen.findByText("Lojas: DIPIRONA");
    const grade = (await screen.findByLabelText("Selecionar DIPIRONA")).closest("[data-arrow-root]") as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(grade));
    fireEvent.keyDown(grade, { key: "ArrowDown" });
    expect(await screen.findByText("Lojas: AAS")).toBeDefined();
    fireEvent.keyDown(grade, { key: " " });
    expect(await screen.findByText("1 produto selecionado")).toBeDefined();
    fireEvent.keyDown(grade, { key: " " });
    expect(await screen.findByText("0 produtos selecionados")).toBeDefined();
    fireEvent.keyDown(grade, { key: "ArrowUp" });
    expect(await screen.findByText("Lojas: DIPIRONA")).toBeDefined();
  });

  it("não congela a coluna Produto: ela rola com as demais", async () => {
    renderizar();
    const celula = (await screen.findByText("DIPIRONA", { selector: "td *, td" })).closest("td") as HTMLElement;
    expect(celula.style.position).not.toBe("sticky");
  });

  it("a movimentação mensal usa só a Loja selecionada, e todas quando o campo é desmarcado", async () => {
    renderizar();
    await screen.findByText("03/2027");
    const chamadas = () => apiFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/movimentacao"));
    await waitFor(() => expect(chamadas().at(-1)).toContain("lojas=1"));
    const marca = screen.getByRole("checkbox", { name: "Apenas a Loja selecionada" });
    expect(marca.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(marca);
    await waitFor(() => expect(chamadas().at(-1)).not.toContain("lojas="));
  });

  it("mantém a seleção quando a busca tira o produto da grade", async () => {
    renderizar();
    fireEvent.click(await screen.findByLabelText("Selecionar DIPIRONA"));
    fireEvent.change(screen.getByPlaceholderText("Buscar produto"), { target: { value: "AAS" } });
    await waitFor(() => expect(screen.getByText("1 produto selecionado")).toBeDefined());
    expect(await screen.findByText("Lojas: AAS")).toBeDefined();
  });

  it("mostra o mínimo e a sugestão de cada produto na grade", async () => {
    renderizar();
    await screen.findByLabelText("Selecionar AAS");
    expect(screen.getAllByText("Sugestão").length).toBeGreaterThan(0);
    expect(screen.getAllByText("A chegar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mín.").length).toBeGreaterThan(0);
  });

  it("filtra apenas os produtos com estoque mínimo", async () => {
    renderizar();
    await screen.findByLabelText("Selecionar DIPIRONA");
    await abrirFiltros();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Apenas com estoque mínimo" }));
    expect(apiFetch.mock.calls.some(([u]) => String(u).includes("apenasMinimo=1"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => String(u).includes("/produtos") && String(u).includes("apenasMinimo=1"))).toBe(true));
  });

  it("edita o mínimo da Loja na célula e grava com a version", async () => {
    renderizar();
    fireEvent.click(await screen.findByText("AAS", { selector: "td" }));
    const campo = await screen.findByLabelText("Estoque mínimo da Loja Centro");
    await waitFor(() => expect((campo as HTMLInputElement).value).toBe("8"));
    fireEvent.change(campo, { target: { value: "12" } });
    fireEvent.blur(campo);
    await waitFor(() => {
      const put = apiFetch.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse(put?.[1].body)).toEqual({ produtoId: "p-2", codigoLoja: 1, minimo: 12, maximo: 20, version: 2 });
    });
  });

  it("gravar o mínimo atualiza só a linha, a partir da resposta do PUT, sem recarregar a grade", async () => {
    renderizar();
    fireEvent.click(await screen.findByText("AAS", { selector: "td" }));
    const campo = await screen.findByLabelText("Estoque mínimo da Loja Centro");
    await waitFor(() => expect((campo as HTMLInputElement).value).toBe("8"));
    const consultas = () => apiFetch.mock.calls.filter(([u]) => String(u).includes("/pedidos/lancamento/produtos")).length;
    const antes = consultas();
    fireEvent.change(campo, { target: { value: "12" } });
    fireEvent.blur(campo);
    // Sugestão = vendida (1) + mínimo (12) - estoque (4) = 9, na linha do produto e na da Loja.
    const linhaProduto = screen.getByText("AAS", { selector: "td" }).closest("tr") as HTMLElement;
    await waitFor(() => {
      expect(linhaProduto.querySelector('td[data-col="minimo"]')?.textContent).toBe("12,00");
      expect(linhaProduto.querySelector('td[data-col="sugestao"]')?.textContent).toBe("9,00");
    });
    const linhaLoja = screen.getByLabelText("Estoque mínimo da Loja Centro").closest("tr") as HTMLElement;
    expect(linhaLoja.querySelector('td[data-col="sugestao"]')?.textContent).toBe("9,00");
    expect((screen.getByLabelText("Estoque mínimo da Loja Centro") as HTMLInputElement).value).toBe("12");
    expect(consultas()).toBe(antes);
    // A version devolvida vale para a próxima edição.
    fireEvent.change(screen.getByLabelText("Estoque mínimo da Loja Centro"), { target: { value: "15" } });
    fireEvent.blur(screen.getByLabelText("Estoque mínimo da Loja Centro"));
    await waitFor(() => {
      const puts = apiFetch.mock.calls.filter(([, init]) => init?.method === "PUT");
      expect(puts).toHaveLength(2);
      expect(JSON.parse(puts[1]?.[1].body).version).toBe(3);
    });
  });

  it("um 409 ao gravar o mínimo recarrega a grade", async () => {
    const { ApiError } = await import("@platform/ui/lib/api");
    renderizar();
    fireEvent.click(await screen.findByText("AAS", { selector: "td" }));
    const campo = await screen.findByLabelText("Estoque mínimo da Loja Centro");
    await waitFor(() => expect((campo as HTMLInputElement).value).toBe("8"));
    const consultas = () => apiFetch.mock.calls.filter(([u]) => String(u).includes("/pedidos/lancamento/produtos")).length;
    const antes = consultas();
    putResposta = new ApiError("O estoque mínimo foi alterado por outra pessoa. A grade foi recarregada.", 409);
    fireEvent.change(campo, { target: { value: "12" } });
    fireEvent.blur(campo);
    await waitFor(() => expect(consultas()).toBe(antes + 1));
  });

  it("sem a Permission de editar, os valores aparecem só para leitura", async () => {
    contextoAtual = { ...contexto, podeEditarMinimos: false };
    renderizar();
    fireEvent.click(await screen.findByText("AAS", { selector: "td" }));
    await screen.findByText("Lojas: AAS");
    expect(screen.queryByLabelText("Estoque mínimo da Loja Centro")).toBeNull();
  });

  it("não oferece filtro por Listas de produtos", async () => {
    renderizar();
    await screen.findByLabelText("Selecionar DIPIRONA");
    await abrirFiltros();
    expect(screen.queryByRole("combobox", { name: "Listas de produtos" })).toBeNull();
  });
});

describe("Pedidos: tela", () => {
  it("mostra a grade, as Lojas e a movimentação mensal de uma vez, sem filtros na tela", async () => {
    renderizar();
    fireEvent.click(await screen.findByLabelText("Selecionar DIPIRONA"));
    expect(await screen.findByText("Lojas: DIPIRONA")).toBeDefined();
    expect(await screen.findByText("Movimentação mensal: DIPIRONA")).toBeDefined();
    expect(screen.queryByLabelText("Modo da data")).toBeNull();
    expect(screen.getByRole("button", { name: "Gerar pedido" })).toBeDefined();
  });
});

describe("Pedidos: filtros", () => {
  it("tem um só Filtro de produtos no lugar de Laboratório, Grupo e Seção, e a barra de visões logo depois da data", async () => {
    renderizar();
    await screen.findByLabelText("Selecionar DIPIRONA");
    expect(screen.queryByText("Filtro de produtos")).toBeNull();
    await abrirFiltros();
    expect(screen.getByText("Filtro de produtos")).toBeTruthy();
    for (const antigo of ["Laboratório", "Grupo", "Seção"]) expect(screen.queryByLabelText(antigo)).toBeNull();
    const antes = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const visao = screen.getByLabelText("Visão");
    expect(antes(screen.getByLabelText("Modo da data"), visao)).toBe(true);
    expect(antes(visao, screen.getByText("Filtro de produtos"))).toBe(true);
    expect(antes(visao, screen.getByLabelText("Lojas"))).toBe(true);
    expect(antes(screen.getByLabelText("Lojas"), screen.getByText("Filtro de produtos"))).toBe(true);
  });

  it("só aplica os filtros ao clicar em Filtrar, que fecha o sheet", async () => {
    renderizar();
    await screen.findByLabelText("Selecionar DIPIRONA");
    await abrirFiltros();
    fireEvent.click(screen.getByRole("checkbox", { name: "Apenas com estoque mínimo" }));
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(screen.queryByLabelText("Modo da data")).toBeNull());
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => String(u).includes("apenasMinimo=1"))).toBe(true));
    // Reabrir mostra o que foi aplicado.
    await abrirFiltros();
    expect((screen.getByRole("checkbox", { name: "Apenas com estoque mínimo" }) as HTMLInputElement).getAttribute("aria-checked")).toBe("true");
  });
});

describe("Pedidos: visões salvas", () => {
  it("abre com a visão padrão aplicada, mas com a data no padrão (ontem)", async () => {
    visoes = [{ ...visaoBase, id: "ppv_1", nome: "Genéricos Centro", padrao: true }];
    renderizar();
    await screen.findByLabelText("Selecionar DIPIRONA");
    const urls = apiFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/produtos"));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("lojas=1");
    expect(urls[0]).not.toContain("listas=");
    expect(JSON.parse(new URL(urls[0] ?? "", "http://x").searchParams.get("entradas") ?? "[]")).toEqual([{ tipo: "laboratorio", id: "7" }]);
    expect(urls[0]).toContain("de=2027-04-09");
  });

  it("salva a visão atual com os filtros e sem a data, como padrão", async () => {
    renderizar();
    await screen.findByLabelText("Selecionar DIPIRONA");
    await abrirFiltros();
    fireEvent.click(screen.getByRole("checkbox", { name: "Apenas com estoque mínimo" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar visão" }));
    fireEvent.change(await screen.findByLabelText("Nome da visão"), { target: { value: "Minha" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Abrir por padrão" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => String(c[0]).endsWith("/pedidos/visoes") && c[1]?.method === "POST")).toBe(true));
    const chamada = apiFetch.mock.calls.find((c) => String(c[0]).endsWith("/pedidos/visoes") && c[1]?.method === "POST");
    const corpo = JSON.parse(chamada?.[1].body as string);
    expect(corpo).toEqual({ nome: "Minha", lojas: [], entradas: [], apenasComMinimo: true, padrao: true });
  });

  it("aplica outra visão escolhida na lista", async () => {
    visoes = [{ ...visaoBase, id: "ppv_1", nome: "Genéricos Centro", padrao: false }];
    renderizar();
    await screen.findByLabelText("Selecionar DIPIRONA");
    await abrirFiltros();
    fireEvent.click(screen.getByRole("combobox", { name: "Visão" }));
    const opcao = await screen.findByRole("option", { name: "Genéricos Centro" });
    // O Select só aceita o clique em um item destacado, e o destaque vem do movimento do mouse.
    fireEvent.mouseMove(opcao);
    fireEvent.click(opcao);
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => String(c[0]).includes("/produtos") && String(c[0]).includes("lojas=1"))).toBe(true));
  });
});
