// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { PedidosPage } from "./pedidos-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const contexto = {
  hoje: "2027-04-10",
  ontem: "2027-04-09",
  lojas: [{ codigo: 1, nome: "Centro" }],
  laboratorios: [{ id: "7", nome: "EMS" }],
  grupos: [{ id: "3", nome: "MEDICAMENTOS" }],
  secoes: [{ id: "9", nome: "GENERICOS" }],
  listas: [{ id: "plp_1", nome: "Vitaminas" }],
  podeEditarMinimos: true,
};
const visaoBase = { lojas: [1], listas: ["plp_1"], laboratorio: "7", grupo: null, secao: null, apenasComMinimo: false, usuarioId: "ana", version: 1 };
let visoes: unknown[];
const dipirona = { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", vendida: 5, estoque: 10, minimo: 0, sugestao: 0, aChegar: 0, lojas: [{ codigoLoja: 1, vendida: 5, estoque: 10, minimo: null, maximo: null, sugestao: 0, aChegar: 0, version: 0 }] };
const aas = { produtoId: "p-2", nome: "AAS", codigoBarra: null, vendida: 1, estoque: 4, minimo: 8, sugestao: 5, aChegar: 7, lojas: [{ codigoLoja: 1, vendida: 1, estoque: 4, minimo: 8, maximo: 20, sugestao: 5, aChegar: 7, version: 2 }] };
let produtos: unknown[];

beforeEach(() => {
  produtos = [dipirona, aas];
  visoes = [];
  contextoAtual = contexto;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/contexto")) return contextoAtual;
    if (url.includes("/pedidos/visoes")) return visoes;
    if (url.includes("/movimentacao")) return [{ mes: "2027-03", vendida: 12, comprada: 30 }];
    return produtos;
  });
});
afterEach(cleanup);

let contextoAtual = contexto;
const renderizar = () => render(<UiProvider><PedidosPage /></UiProvider>, { wrapper: MemoryRouter });

describe("Pedidos: Lançamento", () => {
  it("abre com o dia anterior e sem outros filtros", async () => {
    renderizar();
    expect(await screen.findByLabelText("Selecionar DIPIRONA")).toBeDefined();
    const url = String(apiFetch.mock.calls.map((c) => c[0]).find((u: string) => u.includes("/produtos")));
    expect(url).toContain("modo=periodo");
    expect(url).toContain("de=2027-04-09");
    expect(url).toContain("ate=2027-04-09");
    expect(url).not.toContain("lojas=");
    expect(url).not.toContain("grupo=");
  });

  it("ao marcar um produto mostra as Lojas e a movimentação mensal", async () => {
    renderizar();
    fireEvent.click(await screen.findByLabelText("Selecionar DIPIRONA"));
    expect(await screen.findByText("Lojas: DIPIRONA")).toBeDefined();
    expect(await screen.findByText("03/2027")).toBeDefined();
    expect(screen.getByText("1 produto selecionado")).toBeDefined();
  });

  it("mantém a seleção quando a busca tira o produto da grade", async () => {
    renderizar();
    fireEvent.click(await screen.findByLabelText("Selecionar DIPIRONA"));
    fireEvent.change(screen.getByPlaceholderText("Buscar produto"), { target: { value: "AAS" } });
    await waitFor(() => expect(screen.getByText("1 produto selecionado")).toBeDefined());
    expect(screen.getByText("Lojas: DIPIRONA")).toBeDefined();
  });

  it("mostra o mínimo e a sugestão de cada produto na grade", async () => {
    renderizar();
    await screen.findByLabelText("Selecionar AAS");
    expect(screen.getByText("Sugestão")).toBeDefined();
    expect(screen.getByText("A chegar")).toBeDefined();
    expect(screen.getByText("Estoque mínimo")).toBeDefined();
  });

  it("filtra apenas os produtos com estoque mínimo", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Apenas com estoque mínimo" }));
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => String(u).includes("/produtos") && String(u).includes("apenasMinimo=1"))).toBe(true));
  });

  it("edita o mínimo da Loja na célula e grava com a version", async () => {
    renderizar();
    fireEvent.click(await screen.findByLabelText("Selecionar AAS"));
    const campo = await screen.findByLabelText("Estoque mínimo da Loja Centro");
    expect((campo as HTMLInputElement).value).toBe("8");
    fireEvent.change(campo, { target: { value: "12" } });
    fireEvent.blur(campo);
    await waitFor(() => {
      const put = apiFetch.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse(put?.[1].body)).toEqual({ produtoId: "p-2", codigoLoja: 1, minimo: 12, maximo: 20, version: 2 });
    });
  });

  it("sem a Permission de editar, os valores aparecem só para leitura", async () => {
    contextoAtual = { ...contexto, podeEditarMinimos: false };
    renderizar();
    fireEvent.click(await screen.findByLabelText("Selecionar AAS"));
    await screen.findByText("Lojas: AAS");
    expect(screen.queryByLabelText("Estoque mínimo da Loja Centro")).toBeNull();
  });

  it("filtra por lista de produtos", async () => {
    renderizar();
    await screen.findByLabelText("Selecionar DIPIRONA");
    fireEvent.input(screen.getByRole("combobox", { name: "Listas de produtos" }), { target: { value: "vit" }, inputType: "insertText" });
    fireEvent.click(await screen.findByRole("option", { name: "Vitaminas" }));
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => String(c[0]).includes("/produtos") && String(c[0]).includes("listas=plp_1"))).toBe(true));
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
    expect(urls[0]).toContain("listas=plp_1");
    expect(urls[0]).toContain("laboratorio=7");
    expect(urls[0]).toContain("de=2027-04-09");
  });

  it("salva a visão atual com os filtros e sem a data, como padrão", async () => {
    renderizar();
    await screen.findByLabelText("Selecionar DIPIRONA");
    fireEvent.click(screen.getByRole("checkbox", { name: "Apenas com estoque mínimo" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar visão" }));
    fireEvent.change(await screen.findByLabelText("Nome da visão"), { target: { value: "Minha" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Abrir por padrão" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => String(c[0]).endsWith("/pedidos/visoes") && c[1]?.method === "POST")).toBe(true));
    const chamada = apiFetch.mock.calls.find((c) => String(c[0]).endsWith("/pedidos/visoes") && c[1]?.method === "POST");
    const corpo = JSON.parse(chamada?.[1].body as string);
    expect(corpo).toEqual({ nome: "Minha", lojas: [], listas: [], laboratorio: null, grupo: null, secao: null, apenasComMinimo: true, padrao: true });
  });

  it("aplica outra visão escolhida na lista", async () => {
    visoes = [{ ...visaoBase, id: "ppv_1", nome: "Genéricos Centro", padrao: false }];
    renderizar();
    await screen.findByLabelText("Selecionar DIPIRONA");
    fireEvent.click(screen.getByRole("combobox", { name: "Visão" }));
    const opcao = await screen.findByRole("option", { name: "Genéricos Centro" });
    // O Select só aceita o clique em um item destacado, e o destaque vem do movimento do mouse.
    fireEvent.mouseMove(opcao);
    fireEvent.click(opcao);
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => String(c[0]).includes("/produtos") && String(c[0]).includes("listas=plp_1") && String(c[0]).includes("lojas=1"))).toBe(true));
  });
});
