// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { PedidosPage } from "./pedidos-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const itens = [{ produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", quantidades: [{ codigoLoja: 1, quantidade: 10 }] }];
const pedido = (status: string, version = 1) => ({ id: "ped_1", status, itens, criadoPorId: "u1", criadoPorNome: "Gil", version, criadoEm: "2027-04-10T12:00:00.000Z", atualizadoEm: "2027-04-10T12:00:00.000Z" });
const fornecedores = [{ codigo: 7, nome: "ALFA DISTRIBUIDORA" }, { codigo: 9, nome: "BETA" }];
const detalhe = (importados: boolean) => ({
  pedido: { id: "ped_1", status: importados ? "cotado" : "aguardando_precos", version: 2 },
  fornecedores: [{ codigo: 7, nome: "ALFA DISTRIBUIDORA", importado: importados, importadoEm: null, version: importados ? 2 : 1 }, { codigo: 9, nome: "Fornecedor 9", importado: importados, importadoEm: null, version: importados ? 2 : 1 }],
  produtos: [{ produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", quantidade: 10, precos: importados ? { 7: 12.5, 9: 11 } : {} }],
});

let situacao = "rascunho";
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
  situacao = "rascunho";
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/contexto")) return { hoje: "2027-04-10", ontem: "2027-04-09", lojas: [{ codigo: 1, nome: "Centro" }], laboratorios: [], grupos: [], secoes: [], listas: [] };
    if (url.includes("/pedidos/visoes") || url.includes("/pedidos/listas")) return [];
    if (url.includes("/pedidos/lancamento/")) return [];
    if (url.includes("/pedidos/fornecedores")) return fornecedores;
    if (url.endsWith("/cotacao/7/planilha")) return { nome: "cotacao-7.xlsx", conteudo: "AAAA" };
    if (url.endsWith("/cotacao/7/previa")) return { validas: 1, semOferta: 0, erros: [], semMatch: [] };
    if (url.endsWith("/cotacao/7/importar")) return detalhe(true);
    if (url.endsWith("/cotacao") && init?.method === "POST") return detalhe(false);
    if (url.endsWith("/cotacao")) return detalhe(situacao === "cotado");
    return [pedido(situacao, situacao === "rascunho" ? 1 : 2)];
  });
});
afterEach(cleanup);

const renderizar = () => render(<UiProvider><PedidosPage /></UiProvider>, { wrapper: MemoryRouter });
const chamadas = (metodo: string) => apiFetch.mock.calls.filter(([, init]) => init?.method === metodo);

describe("Cotação por fornecedor", () => {
  it("escolhe os fornecedores pelo nome do ERP e inicia a cotação do rascunho com a versão", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Pedidos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cotar Pedido de 10/04/2027" }));
    fireEvent.click(await screen.findByLabelText("Selecionar ALFA DISTRIBUIDORA"));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar cotação" }));
    await waitFor(() => expect(chamadas("POST")).toHaveLength(1));
    const [url, init] = chamadas("POST")[0] as [string, RequestInit];
    expect(url).toBe("/api/m/inovafarma/pedidos/pedidos/ped_1/cotacao");
    expect(JSON.parse(String(init.body))).toEqual({ fornecedores: [7], version: 1 });
  });

  it("não inicia sem fornecedor escolhido", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Pedidos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cotar Pedido de 10/04/2027" }));
    await screen.findByLabelText("Selecionar BETA");
    expect((screen.getByRole("button", { name: "Iniciar cotação" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("importa a planilha preenchida depois de conferir a prévia e destaca o menor preço", async () => {
    situacao = "aguardando_precos";
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Pedidos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cotação do Pedido de 10/04/2027" }));
    const arquivo = new File([new Uint8Array([1, 2, 3])], "preenchida.xlsx");
    fireEvent.change(await screen.findByLabelText("Planilha preenchida de ALFA DISTRIBUIDORA"), { target: { files: [arquivo] } });
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
      if (url.includes("/contexto")) return { hoje: "2027-04-10", ontem: "2027-04-09", lojas: [], laboratorios: [], grupos: [], secoes: [], listas: [] };
      if (url.includes("/pedidos/visoes") || url.includes("/pedidos/listas")) return [];
      if (url.includes("/pedidos/lancamento/")) return [];
      if (url.endsWith("/cotacao/7/previa")) return { validas: 0, semOferta: 0, erros: [{ linha: 2, mensagem: "Preço inválido." }], semMatch: [] };
      if (url.endsWith("/cotacao")) return detalhe(false);
      return [pedido("aguardando_precos", 2)];
    });
    renderizar();
    fireEvent.click(await screen.findByRole("tab", { name: "Pedidos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cotação do Pedido de 10/04/2027" }));
    fireEvent.change(await screen.findByLabelText("Planilha preenchida de ALFA DISTRIBUIDORA"), { target: { files: [new File([new Uint8Array([1])], "x.xlsx")] } });
    expect(await screen.findByText(/Linha 2: Preço inválido\./)).toBeDefined();
    expect(chamadas("POST").some(([u]) => String(u).endsWith("/importar"))).toBe(false);
  });
});
