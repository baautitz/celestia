// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HeaderActionsProvider, useHeaderActions } from "@platform/ui/context/header-actions";
import { UiProvider } from "@platform/ui/imperative/provider";
import { ApiError } from "@platform/ui/lib/api";
import { PedidosPage } from "./pedidos-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const lojas = [
  { codigo: 1, nome: "Centro" },
  { codigo: 2, nome: "Norte" },
];

const faltaNormal = {
  id: "flt_1",
  produtoId: "p-1",
  nomeProduto: "DIPIRONA 500MG",
  codigoBarra: "7891",
  codigoLoja: 1,
  quantidade: 4,
  observacao: "Cliente aguardando",
  criadoPorId: "u1",
  criadoPorNome: "Ana",
  criadoEm: "2027-04-08T14:00:00.000Z",
  atualizadoEm: "2027-04-08T14:00:00.000Z",
  version: 1,
  estoque: 0,
  estoquesPorLoja: [{ codigoLoja: 1, estoque: 0 }],
  entradaAposCriacao: false,
  sugerirRemocao: false,
};

const faltaReposta = {
  id: "flt_2",
  produtoId: "p-2",
  nomeProduto: "AAS 100MG",
  codigoBarra: null,
  codigoLoja: null,
  quantidade: 10,
  observacao: "Falta geral",
  criadoPorId: "u1",
  criadoPorNome: "Ana",
  criadoEm: "2027-04-07T10:00:00.000Z",
  atualizadoEm: "2027-04-07T10:00:00.000Z",
  version: 2,
  estoque: 15,
  estoquesPorLoja: [{ codigoLoja: 1, estoque: 10 }, { codigoLoja: 2, estoque: 5 }],
  entradaAposCriacao: true,
  sugerirRemocao: true,
};

let estadoFalteiro: {
  todasAsLojas: boolean;
  lojas: typeof lojas;
  lojasPermitidas: number[] | null;
  itens: (typeof faltaNormal)[];
};
let podeLancamento = false;
let podePedidos = false;

beforeEach(() => {
  vi.useRealTimers();
  podeLancamento = false;
  podePedidos = false;
  estadoFalteiro = {
    todasAsLojas: true,
    lojas,
    lojasPermitidas: null,
    itens: [faltaNormal, faltaReposta],
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.includes("/pedidos/falteiro/produtos")) {
      return [{ id: "p-3", nome: "PARACETAMOL 750MG", codigoBarra: "7893" }];
    }
    if (url.endsWith("/pedidos/falteiro") && (!init?.method || init.method === "GET")) {
      return estadoFalteiro;
    }
    if (url.endsWith("/pedidos/falteiro") && init?.method === "POST") {
      const corpo = JSON.parse(init.body ?? "{}");
      const nova = {
        ...faltaNormal,
        id: "flt_3",
        produtoId: corpo.produtoId,
        nomeProduto: "PARACETAMOL 750MG",
        codigoLoja: corpo.codigoLoja ?? null,
        quantidade: corpo.quantidade ?? null,
        observacao: corpo.observacao ?? null,
        version: 1,
      };
      estadoFalteiro = { ...estadoFalteiro, itens: [nova, ...estadoFalteiro.itens] };
      return nova;
    }
    if (url.includes("/pedidos/falteiro/") && init?.method === "PUT") {
      const corpo = JSON.parse(init.body ?? "{}");
      const atualizado = { ...faltaNormal, ...corpo, version: corpo.version + 1 };
      estadoFalteiro = {
        ...estadoFalteiro,
        itens: estadoFalteiro.itens.map((i) => (i.id === faltaNormal.id ? atualizado : i)),
      };
      return atualizado;
    }
    if (url.includes("/pedidos/falteiro/") && init?.method === "DELETE") {
      estadoFalteiro = {
        ...estadoFalteiro,
        itens: estadoFalteiro.itens.filter((i) => !url.includes(i.id)),
      };
      return null;
    }
    if (url.includes("/pedidos/lancamento/contexto")) {
      if (!podeLancamento) throw new ApiError("Sem permissão", 403);
      return { hoje: "2027-04-10", ontem: "2027-04-09", lojas, podeEditarMinimos: false };
    }
    if (url.includes("/pedidos/meu-escopo") || url.endsWith("/pedidos/pedidos")) {
      if (!podePedidos) throw new ApiError("Sem permissão", 403);
      return { lojas: null };
    }
    if (url.includes("/pedidos/limites")) {
      throw new ApiError("Sem permissão", 403);
    }
    return [];
  });
});
afterEach(cleanup);

const HeaderSlot = () => <>{useHeaderActions().actions}</>;
const renderizar = (initialEntries = ["/inovafarma/pedidos"]) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <UiProvider>
        <HeaderActionsProvider>
          <HeaderSlot />
          <PedidosPage />
        </HeaderActionsProvider>
      </UiProvider>
    </MemoryRouter>,
  );

describe("Pedidos: aba Falteiro", () => {
  it("abre a aba Falteiro mesmo para quem não tem permissão de Lançamento nem de Pedidos, exibindo estoque e sugestão de remoção", async () => {
    renderizar();
    expect(await screen.findByText("DIPIRONA 500MG")).toBeDefined();
    expect(screen.getByText("AAS 100MG")).toBeDefined();
    expect(screen.getByText("Todas as Lojas")).toBeDefined();
    // Sugestão clara para remover quando estoque > 0 e entrada pós-criação
    expect(screen.getByText("Reposto · Sugerir remoção")).toBeDefined();
    expect(screen.getByText("Em falta")).toBeDefined();
    const linhaReposta = screen.getByText("AAS 100MG", { selector: "td, td span" }).closest("tr") as HTMLElement;
    expect(linhaReposta.getAttribute("data-highlight")).toBe("true");
  });

  it("busca produto no ERP e registra falta no Falteiro revalidando a lista", async () => {
    renderizar();
    await screen.findByText("DIPIRONA 500MG");
    const botoes = await screen.findAllByRole("button", { name: "Registrar falta" });
    fireEvent.click(botoes[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Registrar falta" });
    const busca = within(dialog).getByLabelText(/Produto/);
    fireEvent.change(busca, { target: { value: "PARACETAMOL" } });
    // Com um só resultado após 300ms, ProdutoBusca escolhe automaticamente
    await waitFor(() => expect((busca as HTMLInputElement).value).toContain("PARACETAMOL 750MG"));

    fireEvent.change(within(dialog).getByLabelText(/Quantidade desejada/), { target: { value: "6" } });
    fireEvent.change(within(dialog).getByLabelText(/Observação/), { target: { value: "Procura alta" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(await screen.findByText("PARACETAMOL 750MG")).toBeDefined();
    const post = apiFetch.mock.calls.find(([u, init]) => String(u).endsWith("/pedidos/falteiro") && init?.method === "POST");
    expect(JSON.parse(post?.[1].body)).toEqual({
      produtoId: "p-3",
      codigoLoja: null,
      quantidade: 6,
      observacao: "Procura alta",
    });
  });

  it("edita e remove registro ativo com version e revalidação", async () => {
    renderizar();
    await screen.findByText("DIPIRONA 500MG");

    fireEvent.click(screen.getByRole("button", { name: "Editar falta de DIPIRONA 500MG" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar falta" });
    const qtd = within(dialog).getByLabelText(/Quantidade desejada/);
    fireEvent.change(qtd, { target: { value: "9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("/pedidos/falteiro/flt_1"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remover falta de AAS 100MG" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remover" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("/pedidos/falteiro/flt_2?version=2"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() => expect(screen.queryByText("AAS 100MG")).toBeNull());
  });

  it("revalida a lista com o estado atual do servidor mesmo quando a remoção falha com 409", async () => {
    renderizar();
    await screen.findByText("DIPIRONA 500MG");

    apiFetch.mockImplementationOnce(async () => {
      // Enquanto tentava remover, no servidor outra falta ganhou sugestão de remoção
      estadoFalteiro = {
        ...estadoFalteiro,
        itens: estadoFalteiro.itens.map((i) => (i.id === "flt_1" ? { ...i, nomeProduto: "DIPIRONA REVALIDADA", sugerirRemocao: true } : i)),
      };
      throw new ApiError("O registro do Falteiro foi alterado por outra pessoa.", 409);
    });

    fireEvent.click(screen.getByRole("button", { name: "Remover falta de DIPIRONA 500MG" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remover" }));
    expect(await screen.findByText("DIPIRONA REVALIDADA")).toBeDefined();
  });
});
