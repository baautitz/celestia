// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HeaderActionsProvider } from "@platform/ui/context/header-actions";
import { UiProvider } from "@platform/ui/imperative/provider";
import { PedidosPage } from "./pedidos-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const itens = [{ produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", quantidades: [{ codigoLoja: 1, quantidade: 10, codigosFornecedor: [7] }] }];
let semDistribuidora = false;
const pedido = (status: string, version = 1) => ({ id: "ped_1", status, itens: semDistribuidora ? itens.map((i) => ({ ...i, quantidades: i.quantidades.map(({ codigoLoja, quantidade }) => ({ codigoLoja, quantidade })) })) : itens, criadoPorId: "u1", criadoPorNome: "Gil", version, criadoEm: "2027-04-10T12:00:00.000Z", atualizadoEm: "2027-04-10T12:00:00.000Z" });
const fornecedores = [{ codigo: 7, nome: "ALFA DISTRIBUIDORA" }, { codigo: 9, nome: "BETA" }];
const detalhe = (importados: boolean) => ({
  pedido: { id: "ped_1", status: importados ? "cotado" : "aguardando_precos", version: 2 },
  fornecedores: [{ codigo: 7, nome: "ALFA DISTRIBUIDORA", importado: importados, importadoEm: null, version: importados ? 2 : 1 }, { codigo: 9, nome: "Fornecedor 9", importado: importados, importadoEm: null, version: importados ? 2 : 1 }],
  produtos: [{ produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", quantidade: 10, lojas: [{ codigoLoja: 1, quantidade: 10 }], precos: importados ? { 7: 12.5, 9: 11 } : {} }],
});

const cotadoParaConfirmar = (podeConfirmar: boolean, status = "cotado", escolhas: Record<string, number> = {}) => ({
  ...detalhe(true),
  pedido: { id: "ped_1", status, version: 2, escolhas },
  podeConfirmar,
  fornecedores: [{ codigo: 7, nome: "ALFA DISTRIBUIDORA", importado: true, importadoEm: null, version: 2 }, { codigo: 9, nome: "BETA", importado: true, importadoEm: null, version: 2 }],
});

let situacao = "rascunho";
let corpoCotacao: unknown = null;
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
  situacao = "rascunho";
  semDistribuidora = false;
  corpoCotacao = null;
  Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/contexto")) return { hoje: "2027-04-10", ontem: "2027-04-09", lojas: [{ codigo: 1, nome: "Centro" }] };
    if (url.includes("/pedidos/visoes")) return [];
    if (url.includes("/pedidos/lancamento/")) return [];
    if (url.includes("/pedidos/fornecedores")) return fornecedores;
    if (url.endsWith("/cotacao/7/planilha")) return { nome: "cotacao-7.xlsx", conteudo: "AAAA" };
    if (url.endsWith("/cotacao/identificar")) return { codigoFornecedor: 7 };
    if (url.endsWith("/cotacao/7/previa")) return { validas: 1, semOferta: 0, quantidadesDiferentes: 0, erros: [], semMatch: [] };
    if (url.endsWith("/cotacao/7/importar")) return detalhe(true);
    if (url.endsWith("/confirmar")) return { ...pedido("confirmado", 3), escolhas: { "p-1": 7 } };
    if (url.endsWith("/pdf/7")) return { nome: "pedido-7.pdf", conteudo: "AAAA" };
    if (url.endsWith("/conferir")) return { pedido: pedido("parcialmente_recebido", 4), linhas: [{ produtoId: "p-1", nome: "DIPIRONA", codigoLoja: 1, pedida: 10, recebida: 4, estado: "parcial" }] };
    if (url.endsWith("/cotacao") && init?.method === "POST") return detalhe(false);
    if (corpoCotacao && url.endsWith("/cotacao")) return corpoCotacao;
    if (url.endsWith("/cotacao")) return detalhe(situacao === "cotado");
    return [pedido(situacao, situacao === "rascunho" ? 1 : 2)];
  });
});
afterEach(cleanup);

const renderizar = () => render(<UiProvider><HeaderActionsProvider><PedidosPage /></HeaderActionsProvider></UiProvider>, { wrapper: MemoryRouter });
const chamadas = (metodo: string) => apiFetch.mock.calls.filter(([, init]) => init?.method === metodo);

describe("Cotação por fornecedor", () => {
  it("inicia a cotação do rascunho direto, com as distribuidoras das linhas e a versão", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Pedidos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cotar Pedido de 10/04/2027" }));
    await waitFor(() => expect(chamadas("POST")).toHaveLength(1));
    const [url, init] = chamadas("POST")[0] as [string, RequestInit];
    expect(url).toBe("/api/m/inovafarma/pedidos/pedidos/ped_1/cotacao");
    expect(JSON.parse(String(init.body))).toEqual({ fornecedores: [7], version: 1 });
  });

  it("não inicia a cotação sem distribuidora nas linhas", async () => {
    semDistribuidora = true;
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Pedidos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cotar Pedido de 10/04/2027" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(chamadas("POST")).toHaveLength(0);
  });

  it("importa a planilha preenchida depois de conferir a prévia e destaca o menor preço", async () => {
    situacao = "aguardando_precos";
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Pedidos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cotação do Pedido de 10/04/2027" }));
    const arquivo = new File([new Uint8Array([1, 2, 3])], "preenchida.xlsx");
    fireEvent.change(await screen.findByLabelText("Planilhas preenchidas"), { target: { files: [arquivo] } });
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/1 preço válido/)).toBeDefined();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Importar preços" }));
    await waitFor(() => expect(chamadas("POST").some(([u]) => String(u).endsWith("/cotacao/7/importar"))).toBe(true));
    const previa = chamadas("POST").find(([u]) => String(u).endsWith("/cotacao/7/previa")) as [string, RequestInit];
    expect(JSON.parse(String(previa[1].body))).toEqual({ arquivo: "AQID" });
    const importar = chamadas("POST").find(([u]) => String(u).endsWith("/cotacao/7/importar")) as [string, RequestInit];
    expect(JSON.parse(String(importar[1].body))).toEqual({ arquivo: "AQID", version: 1 });
    expect((await screen.findByTitle("Menor preço")).textContent).toBe("11,00");
    expect(screen.getByText("12,50")).toBeDefined();
  });

  it("mostra os erros da prévia e não importa", async () => {
    situacao = "aguardando_precos";
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/contexto")) return { hoje: "2027-04-10", ontem: "2027-04-09", lojas: [] };
      if (url.includes("/pedidos/visoes")) return [];
      if (url.includes("/pedidos/lancamento/")) return [];
      if (url.endsWith("/cotacao/identificar")) return { codigoFornecedor: 7 };
      if (url.endsWith("/cotacao/7/previa")) return { validas: 0, semOferta: 0, quantidadesDiferentes: 0, erros: [{ linha: 2, mensagem: "Preço inválido." }], semMatch: [] };
      if (url.endsWith("/cotacao")) return detalhe(false);
      return [pedido("aguardando_precos", 2)];
    });
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Pedidos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cotação do Pedido de 10/04/2027" }));
    fireEvent.change(await screen.findByLabelText("Planilhas preenchidas"), { target: { files: [new File([new Uint8Array([1])], "x.xlsx")] } });
    expect(await screen.findByText(/Linha 2: Preço inválido\./)).toBeDefined();
    expect(chamadas("POST").some(([u]) => String(u).endsWith("/importar"))).toBe(false);
  });
});

describe("Escolha do fornecedor e confirmação", () => {
  const abrir = async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Pedidos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cotação do Pedido de 10/04/2027" }));
  };

  it("pré-seleciona o menor preço, deixa trocar e confirma com a versão do Pedido", async () => {
    situacao = "cotado";
    corpoCotacao = cotadoParaConfirmar(true);
    await abrir();
    const beta = await screen.findByRole("checkbox", { name: "Escolher BETA para DIPIRONA" });
    const alfa = screen.getByRole("checkbox", { name: "Escolher ALFA DISTRIBUIDORA para DIPIRONA" });
    expect(beta.getAttribute("aria-checked")).toBe("true");
    // Marca as duas: a segunda entra com o que falta (nada); depois desmarca a primeira e remarca para receber tudo.
    fireEvent.click(alfa);
    expect(screen.getByRole("checkbox", { name: "Escolher BETA para DIPIRONA" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Quantidade de ALFA DISTRIBUIDORA para DIPIRONA em Centro" }).value).toBe("0");
    fireEvent.click(screen.getByRole("checkbox", { name: "Escolher BETA para DIPIRONA" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Escolher ALFA DISTRIBUIDORA para DIPIRONA" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Escolher ALFA DISTRIBUIDORA para DIPIRONA" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Pedido" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirmar Pedido" }));
    await waitFor(() => expect(chamadas("POST").some(([u]) => String(u).endsWith("/confirmar"))).toBe(true));
    const [, init] = chamadas("POST").find(([u]) => String(u).endsWith("/confirmar")) as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ escolhas: { "p-1": [{ codigoLoja: 1, codigoFornecedor: 7, quantidade: 10 }] }, version: 2 });
  });

  it("não oferece a escolha a quem não pode confirmar", async () => {
    situacao = "cotado";
    corpoCotacao = cotadoParaConfirmar(false);
    await abrir();
    await screen.findByTitle("Menor preço");
    expect(screen.queryByRole("button", { name: "Confirmar Pedido" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Escolher BETA para DIPIRONA" })).toBeNull();
  });

  it("baixa o PDF de cada fornecedor escolhido e confere com a NF mostrando os estados", async () => {
    situacao = "confirmado";
    corpoCotacao = cotadoParaConfirmar(true, "confirmado", { "p-1": 7 });
    await abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Baixar PDFs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Baixar PDF de ALFA DISTRIBUIDORA" }));
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => String(u).endsWith("/ped_1/pdf/7"))).toBe(true));
    expect(screen.queryByRole("button", { name: "Baixar PDF de BETA" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByText("PDFs do Pedido por fornecedor")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Conferir NF" }));
    expect(await screen.findByText("Parcial")).toBeDefined();
    expect(chamadas("POST").some(([u]) => String(u).endsWith("/ped_1/conferir"))).toBe(true);
  });
});
