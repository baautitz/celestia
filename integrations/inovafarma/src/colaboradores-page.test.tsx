// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render as renderTela, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { confirmLeave } from "@platform/ui/adapters/leave-guard";
import { ApiError } from "@platform/ui/lib/api";
import { ColaboradoresPage } from "./colaboradores-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const feedback = vi.hoisted(() => ({ notify: vi.fn(), notifyError: vi.fn() }));
const windows = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("@platform/ui/imperative/provider", () => ({ useUi: () => ({ feedback, windows }) }));

/** Monta a tela num roteador de dados, com um link para outra tela, como no app. */
function render(tela: ReactElement) {
  // O roteador de dados cria um Request com o AbortSignal do jsdom, que o Request do Node recusa.
  vi.stubGlobal("Request", class { constructor(readonly url: string, init?: RequestInit) { Object.assign(this, init); } });
  const router = createMemoryRouter([
    { path: "/", element: <><Link to="/outra">Ir para outra tela</Link>{tela}</> },
    { path: "/outra", element: "Outra tela" },
  ]);
  return renderTela(<RouterProvider router={router} future={{ v7_startTransition: true }} />);
}

const pendente = { confirmado: false, usuarioId: null, usuario: null, lojas: [] as number[], version: 0, avisos: [] as { tipo: string; mensagem: string }[], sugestao: null };
const ana = { id: "ana", fullname: "Ana Souza", username: "ana.souza" };
const bia = { id: "bia", fullname: "Bia Lima", username: "bia.lima" };
const lista = {
  colaboradores: [
    { codigoColaborador: 7, nome: "ANA SOUZA", ativo: true, ...pendente },
    { codigoColaborador: 9, nome: "BRUNO LIMA", ativo: false, ...pendente },
  ],
  usuarios: [ana, bia],
  lojas: [
    { codigo: 1, nome: "Centro" },
    { codigo: 2, nome: "Bairro" },
    { codigo: 3, nome: "Shopping" },
  ],
};
const vinculadoAna = { confirmado: true, usuarioId: "ana", usuario: { ...ana, status: "active" }, lojas: [] as number[], version: 3, avisos: [] as { tipo: string; mensagem: string }[], sugestao: null };
const listaComVinculo = {
  ...lista,
  colaboradores: [{ codigoColaborador: 7, nome: "ANA SOUZA", ativo: true, ...vinculadoAna }],
};

async function linha(nome: string) {
  return (await screen.findByText(nome)).closest("tr") as HTMLElement;
}

async function escolherUsuario(row: HTMLElement, nome: string) {
  const campo = within(row).getByRole("combobox", { name: /^Usuário de / });
  fireEvent.input(campo, { target: { value: nome.slice(0, 3) }, inputType: "insertText" });
  const opcao = await screen.findByRole("option", { name: nome });
  fireEvent.mouseMove(opcao);
  fireEvent.click(opcao);
  await waitFor(() => expect((campo as HTMLInputElement).value).toBe(nome));
}

async function escolherLoja(row: HTMLElement, nome: string) {
  fireEvent.input(within(row).getByRole("combobox", { name: /^Lojas de / }), { target: { value: nome.slice(0, 3) }, inputType: "insertText" });
  const opcao = await screen.findByRole("option", { name: nome });
  fireEvent.mouseMove(opcao);
  fireEvent.click(opcao);
  await within(row).findByText(nome);
}

const botao = (row: HTMLElement, nome: string) => within(row).getByRole("button", { name: nome }) as HTMLButtonElement;

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ColaboradoresPage", () => {
  it("abre só nos ativos, com Cód. e nome", async () => {
    apiFetch.mockResolvedValue(lista);
    render(<ColaboradoresPage />);
    expect(await screen.findByText("ANA SOUZA")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.queryByText("BRUNO LIMA")).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith("/api/m/inovafarma/colaboradores");
  });

  it("mostra todos pelo filtro de situação", async () => {
    apiFetch.mockResolvedValue(lista);
    render(<ColaboradoresPage />);
    await screen.findByText("ANA SOUZA");
    fireEvent.click(screen.getByRole("combobox", { name: "Situação" }));
    const todos = await screen.findByRole("option", { name: "Todos" });
    // O Select só aceita o clique em um item destacado, e o destaque vem do movimento do mouse.
    fireEvent.mouseMove(todos);
    fireEvent.click(todos);
    expect(await screen.findByText("BRUNO LIMA")).toBeTruthy();
    expect(screen.getByText("ANA SOUZA")).toBeTruthy();
  });

  it("mostra o erro em vez de lista vazia e recarrega com Tentar novamente", async () => {
    apiFetch.mockRejectedValueOnce(new Error("ERP InovaFarma indisponível."));
    render(<ColaboradoresPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("ERP InovaFarma indisponível.");
    expect(screen.queryByText("Nenhum Colaborador encontrado.")).toBeNull();

    apiFetch.mockResolvedValueOnce(lista);
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("ANA SOUZA")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("mostra Pendente e Confirmar desabilitado até escolher um Usuário, sem gravar antes de confirmar", async () => {
    apiFetch.mockResolvedValue(lista);
    render(<ColaboradoresPage />);
    const row = await linha("ANA SOUZA");
    expect(within(row).getByText("Pendente")).toBeTruthy();
    const confirmar = within(row).getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    await escolherUsuario(row, "Bia Lima");
    expect(confirmar.disabled).toBe(false);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("o select pesquisa entre os Usuários oferecidos", async () => {
    apiFetch.mockResolvedValue(lista);
    render(<ColaboradoresPage />);
    const campo = within(await linha("ANA SOUZA")).getByRole("combobox", { name: "Usuário de ANA SOUZA" });
    fireEvent.input(campo, { target: { value: "Bia" }, inputType: "insertText" });
    expect(await screen.findByRole("option", { name: "Bia Lima" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Ana Souza" })).toBeNull();
  });

  it("Confirmar grava o vínculo com a version e a linha passa a Confirmado, com Salvar", async () => {
    apiFetch.mockResolvedValueOnce(lista);
    render(<ColaboradoresPage />);
    const row = await linha("ANA SOUZA");
    await escolherUsuario(row, "Bia Lima");

    apiFetch.mockResolvedValueOnce({ codigoColaborador: 7, confirmado: true, usuarioId: "bia", usuario: { ...bia, status: "active" }, version: 1 });
    fireEvent.click(within(row).getByRole("button", { name: "Confirmar" }));

    expect(await within(row).findByText("Confirmado")).toBeTruthy();
    expect(apiFetch).toHaveBeenLastCalledWith("/api/m/inovafarma/colaboradores/7/vinculo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuarioId: "bia", lojas: [], version: 0 }),
    });
    expect((within(row).getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("limpar o campo e salvar desfaz o vínculo e devolve a Pendente", async () => {
    apiFetch.mockResolvedValueOnce(listaComVinculo);
    render(<ColaboradoresPage />);
    const row = await linha("ANA SOUZA");
    expect(within(row).getByText("Confirmado")).toBeTruthy();
    expect((within(row).getByRole("combobox", { name: "Usuário de ANA SOUZA" }) as HTMLInputElement).value).toBe("Ana Souza");

    fireEvent.click(within(row).getByRole("button", { name: "Limpar Usuário" }));
    apiFetch.mockResolvedValueOnce({ codigoColaborador: 7, ...pendente });
    const salvar = within(row).getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    await waitFor(() => expect(salvar.disabled).toBe(false));
    fireEvent.click(salvar);

    expect(await within(row).findByText("Pendente")).toBeTruthy();
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/api/m/inovafarma/colaboradores/7/vinculo",
      expect.objectContaining({ body: JSON.stringify({ usuarioId: null, lojas: [], version: 3 }) }),
    );
  });

  it("no 409 avisa, recarrega a linha e descarta a edição dela", async () => {
    apiFetch.mockResolvedValueOnce(lista);
    render(<ColaboradoresPage />);
    const row = await linha("ANA SOUZA");
    await escolherUsuario(row, "Bia Lima");

    apiFetch.mockRejectedValueOnce(new ApiError("O vínculo foi alterado por outra pessoa. A linha foi recarregada.", 409, "versao_desatualizada"));
    apiFetch.mockResolvedValueOnce(listaComVinculo);
    fireEvent.click(within(row).getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Confirmado")).toBeTruthy();
    expect(feedback.notify).toHaveBeenCalledWith(expect.objectContaining({ description: "O vínculo foi alterado por outra pessoa. A linha foi recarregada.", type: "warning" }));
    expect((screen.getByRole("combobox", { name: "Usuário de ANA SOUZA" }) as HTMLInputElement).value).toBe("Ana Souza");
  });

  it("no 409 de Usuário já vinculado mostra a mensagem e mantém o rascunho inteiro, sem recarregar", async () => {
    apiFetch.mockResolvedValueOnce(lista);
    render(<ColaboradoresPage />);
    const row = await linha("ANA SOUZA");
    await escolherUsuario(row, "Bia Lima");
    await escolherLoja(row, "Shopping");

    const jaVinculado = new ApiError("Este Usuário já está vinculado a outro Colaborador.", 409, "usuario_ja_vinculado");
    apiFetch.mockRejectedValueOnce(jaVinculado);
    fireEvent.click(botao(row, "Confirmar"));

    await waitFor(() => expect(feedback.notifyError).toHaveBeenCalledWith(jaVinculado, "Vínculo não salvo"));
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect((within(row).getByRole("combobox", { name: "Usuário de ANA SOUZA" }) as HTMLInputElement).value).toBe("Bia Lima");
    expect(within(row).getByText("Shopping")).toBeTruthy();
    await waitFor(() => expect(botao(row, "Confirmar").disabled).toBe(false));
  });

  it("em outra falha avisa e mantém a edição, sem recarregar", async () => {
    apiFetch.mockResolvedValueOnce(lista);
    render(<ColaboradoresPage />);
    const row = await linha("ANA SOUZA");
    await escolherUsuario(row, "Bia Lima");

    const negado = new ApiError("Acesso negado.", 403);
    apiFetch.mockRejectedValueOnce(negado);
    fireEvent.click(within(row).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(feedback.notifyError).toHaveBeenCalledWith(negado, expect.any(String)));
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect((within(row).getByRole("combobox", { name: "Usuário de ANA SOUZA" }) as HTMLInputElement).value).toBe("Bia Lima");
  });

  describe("Lojas", () => {
    const comLojas = (lojas: number[]) => ({ ...lista, colaboradores: [{ codigoColaborador: 7, nome: "ANA SOUZA", ativo: true, ...vinculadoAna, lojas }] });

    it("grava só as Lojas, várias, sem Usuário", async () => {
      apiFetch.mockResolvedValueOnce(lista);
      render(<ColaboradoresPage />);
      const row = await linha("ANA SOUZA");
      await escolherLoja(row, "Bairro");
      await escolherLoja(row, "Centro");

      apiFetch.mockResolvedValueOnce({ codigoColaborador: 7, ...pendente, confirmado: true, lojas: [1, 2], version: 1 });
      fireEvent.click(botao(row, "Confirmar"));

      expect(await within(row).findByText("Confirmado")).toBeTruthy();
      expect(apiFetch).toHaveBeenLastCalledWith(
        "/api/m/inovafarma/colaboradores/7/vinculo",
        expect.objectContaining({ body: JSON.stringify({ usuarioId: null, lojas: [1, 2], version: 0 }) }),
      );
      expect(botao(row, "Salvar").disabled).toBe(true);
    });

    it("grava Usuário e Lojas juntos", async () => {
      apiFetch.mockResolvedValueOnce(lista);
      render(<ColaboradoresPage />);
      const row = await linha("ANA SOUZA");
      await escolherUsuario(row, "Bia Lima");
      await escolherLoja(row, "Shopping");

      apiFetch.mockResolvedValueOnce({ codigoColaborador: 7, confirmado: true, usuarioId: "bia", usuario: { ...bia, status: "active" }, lojas: [3], version: 1 });
      fireEvent.click(botao(row, "Confirmar"));

      expect(await within(row).findByText("Confirmado")).toBeTruthy();
      expect(apiFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ usuarioId: "bia", lojas: [3], version: 0 }) }),
      );
    });

    it("limpar Usuário e Lojas desfaz o vínculo", async () => {
      apiFetch.mockResolvedValueOnce(comLojas([1]));
      render(<ColaboradoresPage />);
      const row = await linha("ANA SOUZA");
      expect(within(row).getByText("Centro")).toBeTruthy();

      fireEvent.click(botao(row, "Limpar Usuário"));
      fireEvent.click(botao(row, "Remover Centro"));
      await waitFor(() => expect(within(row).queryByText("Centro")).toBeNull());

      apiFetch.mockResolvedValueOnce({ codigoColaborador: 7, ...pendente });
      fireEvent.click(botao(row, "Salvar"));

      expect(await within(row).findByText("Pendente")).toBeTruthy();
      expect(apiFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ usuarioId: null, lojas: [], version: 3 }) }),
      );
    });

    it("voltar à mesma escolha não é alteração", async () => {
      apiFetch.mockResolvedValueOnce(comLojas([1, 2]));
      render(<ColaboradoresPage />);
      const row = await linha("ANA SOUZA");
      fireEvent.click(botao(row, "Remover Centro"));
      await waitFor(() => expect(botao(row, "Salvar").disabled).toBe(false));
      await escolherLoja(row, "Centro");
      await waitFor(() => expect(botao(row, "Salvar").disabled).toBe(true));
    });

    it("mantém visível uma Loja gravada que saiu do ERP", async () => {
      apiFetch.mockResolvedValueOnce(comLojas([99]));
      render(<ColaboradoresPage />);
      expect(within(await linha("ANA SOUZA")).getByText("Loja não encontrada (cód. 99)")).toBeTruthy();
    });

    it("resume em +N as Lojas que não cabem, com os nomes no title", async () => {
      const largura = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
      const chip = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(80);
      try {
        apiFetch.mockResolvedValueOnce(comLojas([1, 2, 3]));
        render(<ColaboradoresPage />);
        const row = await linha("ANA SOUZA");
        const resumo = await within(row).findByText("+2");
        expect(resumo.getAttribute("title")).toBe("Bairro, Shopping");
      } finally {
        largura.mockRestore();
        chip.mockRestore();
      }
    });
  });

  describe("Sugestões", () => {
    const sugerida = (sugestao: { usuarioId: string | null; lojas: number[] }) => ({
      ...lista,
      colaboradores: [{ codigoColaborador: 7, nome: "ANA SOUZA", ativo: true, ...pendente, sugestao }],
    });
    const campoUsuario = (row: HTMLElement) => within(row).getByRole("combobox", { name: /^Usuário de / }) as HTMLInputElement;
    const celula = (campo: HTMLElement) => campo.closest("td") as HTMLElement;
    const seloUsuario = (row: HTMLElement) => within(celula(campoUsuario(row))).queryByText("Sugestão");
    const seloLojas = (row: HTMLElement) => within(celula(within(row).getByRole("combobox", { name: /^Lojas de / }))).queryByText("Sugestão");

    it("pré-preenche Usuário e Loja com o selo Sugestão, sem gravar ao carregar", async () => {
      apiFetch.mockResolvedValueOnce(sugerida({ usuarioId: "ana", lojas: [2] }));
      render(<ColaboradoresPage />);
      const row = await linha("ANA SOUZA");
      expect(campoUsuario(row).value).toBe("Ana Souza");
      expect(within(row).getByText("Bairro")).toBeTruthy();
      expect(seloUsuario(row)).toBeTruthy();
      expect(seloLojas(row)).toBeTruthy();
      expect(within(row).getByText("Pendente")).toBeTruthy();
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    it("Confirmar grava a sugestão sem alteração e o selo some", async () => {
      apiFetch.mockResolvedValueOnce(sugerida({ usuarioId: "ana", lojas: [2] }));
      render(<ColaboradoresPage />);
      const row = await linha("ANA SOUZA");
      expect(botao(row, "Confirmar").disabled).toBe(false);

      apiFetch.mockResolvedValueOnce({ codigoColaborador: 7, confirmado: true, usuarioId: "ana", usuario: { ...ana, status: "active" }, lojas: [2], version: 1, avisos: [], sugestao: null });
      fireEvent.click(botao(row, "Confirmar"));

      expect(await within(row).findByText("Confirmado")).toBeTruthy();
      expect(apiFetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ usuarioId: "ana", lojas: [2], version: 0 }) }));
      expect(seloUsuario(row)).toBeNull();
      expect(seloLojas(row)).toBeNull();
    });

    it("sem sugestão de Usuário o campo fica vazio e sem selo, e só a Loja traz selo", async () => {
      apiFetch.mockResolvedValueOnce(sugerida({ usuarioId: null, lojas: [2] }));
      render(<ColaboradoresPage />);
      const row = await linha("ANA SOUZA");
      expect(campoUsuario(row).value).toBe("");
      expect(seloUsuario(row)).toBeNull();
      expect(seloLojas(row)).toBeTruthy();
    });

    it("alterar um campo tira só o selo dele", async () => {
      apiFetch.mockResolvedValueOnce(sugerida({ usuarioId: "ana", lojas: [2] }));
      render(<ColaboradoresPage />);
      const row = await linha("ANA SOUZA");
      await escolherUsuario(row, "Bia Lima");
      expect(seloUsuario(row)).toBeNull();
      expect(seloLojas(row)).toBeTruthy();
      fireEvent.click(botao(row, "Remover Bairro"));
      await waitFor(() => expect(seloLojas(row)).toBeNull());
    });

    it("linha confirmada não mostra selo", async () => {
      apiFetch.mockResolvedValueOnce(listaComVinculo);
      render(<ColaboradoresPage />);
      expect(within(await linha("ANA SOUZA")).queryByText("Sugestão")).toBeNull();
    });
  });

  it("filtra por Pendentes e Confirmados", async () => {
    apiFetch.mockResolvedValueOnce({
      ...lista,
      colaboradores: [
        { codigoColaborador: 8, nome: "CARLA DIAS", ativo: true, ...pendente },
        { codigoColaborador: 7, nome: "ANA SOUZA", ativo: true, ...vinculadoAna },
      ],
    });
    render(<ColaboradoresPage />);
    await screen.findByText("CARLA DIAS");
    expect(screen.getByText("ANA SOUZA")).toBeTruthy();

    const filtrar = async (nome: string) => {
      fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
      const opcao = await screen.findByRole("option", { name: nome });
      fireEvent.mouseMove(opcao);
      fireEvent.click(opcao);
    };
    await filtrar("Pendentes");
    await waitFor(() => expect(screen.queryByText("ANA SOUZA")).toBeNull());
    expect(screen.getByText("CARLA DIAS")).toBeTruthy();

    await filtrar("Confirmados");
    expect(await screen.findByText("ANA SOUZA")).toBeTruthy();
    expect(screen.queryByText("CARLA DIAS")).toBeNull();
  });

  describe("Avisos", () => {
    const comAvisos = (avisos: { tipo: string; mensagem: string }[], campos: Record<string, unknown> = {}) => ({
      ...lista,
      colaboradores: [{ codigoColaborador: 7, nome: "ANA SOUZA", ativo: true, ...vinculadoAna, avisos, ...campos }],
    });

    it("mostra Usuário desativado na linha, mantendo o vínculo", async () => {
      apiFetch.mockResolvedValueOnce(comAvisos([{ tipo: "usuario_desativado", mensagem: "Usuário desativado" }]));
      render(<ColaboradoresPage />);
      const row = await linha("ANA SOUZA");
      expect(within(row).getByText("Usuário desativado")).toBeTruthy();
      expect(within(row).getByText("Confirmado")).toBeTruthy();
    });

    it("mostra Inativo no ERP no filtro Todos", async () => {
      apiFetch.mockResolvedValueOnce(comAvisos([{ tipo: "inativo_no_erp", mensagem: "Inativo no ERP" }], { ativo: false }));
      render(<ColaboradoresPage />);
      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      fireEvent.click(await screen.findByRole("combobox", { name: "Situação" }));
      const todos = await screen.findByRole("option", { name: "Todos" });
      fireEvent.mouseMove(todos);
      fireEvent.click(todos);
      expect(within(await linha("ANA SOUZA")).getByText("Inativo no ERP")).toBeTruthy();
    });

    it("mostra Loja não encontrada uma única vez, no chip", async () => {
      apiFetch.mockResolvedValueOnce(comAvisos([{ tipo: "loja_nao_encontrada", mensagem: "Loja não encontrada (cód. 99)" }], { lojas: [99] }));
      render(<ColaboradoresPage />);
      expect(within(await linha("ANA SOUZA")).getAllByText("Loja não encontrada (cód. 99)")).toHaveLength(1);
    });

    describe("Colaborador que sumiu do ERP", () => {
      const orfao = () => comAvisos([{ tipo: "colaborador_nao_encontrado", mensagem: "Não encontrado no ERP" }], { ativo: false });

      it("aparece mesmo com o filtro só nos ativos", async () => {
        apiFetch.mockResolvedValueOnce(orfao());
        render(<ColaboradoresPage />);
        expect(within(await linha("ANA SOUZA")).getByText("Não encontrado no ERP")).toBeTruthy();
      });

      it("desfazer o vínculo grava e tira a linha da tabela", async () => {
        apiFetch.mockResolvedValueOnce(orfao());
        render(<ColaboradoresPage />);
        const row = await linha("ANA SOUZA");
        fireEvent.click(botao(row, "Limpar Usuário"));
        await waitFor(() => expect(botao(row, "Salvar").disabled).toBe(false));

        apiFetch.mockResolvedValueOnce({ codigoColaborador: 7, ...pendente });
        fireEvent.click(botao(row, "Salvar"));

        await waitFor(() => expect(screen.queryByText("ANA SOUZA")).toBeNull());
        expect(apiFetch).toHaveBeenLastCalledWith(
          "/api/m/inovafarma/colaboradores/7/vinculo",
          expect.objectContaining({ body: JSON.stringify({ usuarioId: null, lojas: [], version: 3 }) }),
        );
      });

      it("só permite salvar quando o vínculo fica vazio", async () => {
        apiFetch.mockResolvedValueOnce(orfao());
        render(<ColaboradoresPage />);
        const row = await linha("ANA SOUZA");
        await escolherUsuario(row, "Bia Lima");
        expect(botao(row, "Salvar").disabled).toBe(true);
      });
    });
  });
});

describe("rascunhos não salvos", () => {
  const sair = () => fireEvent.click(screen.getByRole("link", { name: "Ir para outra tela" }));
  const campoUsuario = (row: HTMLElement) => within(row).getByRole("combobox", { name: /^Usuário de / }) as HTMLInputElement;

  async function abrirComRascunho() {
    apiFetch.mockResolvedValue(lista);
    render(<ColaboradoresPage />);
    await escolherUsuario(await linha("ANA SOUZA"), "Ana Souza");
  }

  it("mantém o rascunho ao trocar de página da tabela", async () => {
    const colaboradores = Array.from({ length: 25 }, (_, i) => ({ codigoColaborador: i + 1, nome: `COLABORADOR ${String(i + 1).padStart(2, "0")}`, ativo: true, ...pendente }));
    apiFetch.mockResolvedValue({ ...lista, colaboradores });
    render(<ColaboradoresPage />);
    await escolherUsuario(await linha("COLABORADOR 01"), "Ana Souza");

    fireEvent.click(screen.getByRole("button", { name: /próxima/i }));
    await screen.findByText("COLABORADOR 21");
    expect(screen.queryByText("COLABORADOR 01")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /anterior/i }));

    expect(campoUsuario(await linha("COLABORADOR 01")).value).toBe("Ana Souza");
  }, 20_000); // Duas páginas de 20 linhas com comboboxes: lento com a suíte inteira rodando.

  it("mantém o rascunho ao mudar o filtro", async () => {
    await abrirComRascunho();
    fireEvent.click(screen.getByRole("combobox", { name: "Situação" }));
    const todos = await screen.findByRole("option", { name: "Todos" });
    fireEvent.mouseMove(todos);
    fireEvent.click(todos);
    await screen.findByText("BRUNO LIMA");
    expect(campoUsuario(await linha("ANA SOUZA")).value).toBe("Ana Souza");
  });

  it("confirmar uma linha não afeta o rascunho da outra", async () => {
    const duasAtivas = { ...lista, colaboradores: lista.colaboradores.map((c) => ({ ...c, ativo: true })) };
    apiFetch.mockResolvedValue(duasAtivas);
    render(<ColaboradoresPage />);
    await escolherUsuario(await linha("ANA SOUZA"), "Ana Souza");
    await escolherUsuario(await linha("BRUNO LIMA"), "Bia Lima");

    apiFetch.mockResolvedValue(vinculadoAna);
    fireEvent.click(botao(await linha("ANA SOUZA"), "Confirmar"));
    await within(await linha("ANA SOUZA")).findByText("Confirmado");

    expect(campoUsuario(await linha("BRUNO LIMA")).value).toBe("Bia Lima");
    expect(botao(await linha("BRUNO LIMA"), "Confirmar").disabled).toBe(false);
  });

  it("sem alterações, sai sem pedir confirmação", async () => {
    apiFetch.mockResolvedValue(lista);
    render(<ColaboradoresPage />);
    await screen.findByText("ANA SOUZA");
    sair();
    await screen.findByText("Outra tela");
    expect(windows.confirm).not.toHaveBeenCalled();
  });

  describe("com sugestão", () => {
    const sugerida = { ...lista, colaboradores: [{ codigoColaborador: 7, nome: "ANA SOUZA", ativo: true, ...pendente, sugestao: { usuarioId: "ana", lojas: [2] } }] };

    it("só a sugestão não pede confirmação ao sair", async () => {
      apiFetch.mockResolvedValue(sugerida);
      render(<ColaboradoresPage />);
      await screen.findByText("ANA SOUZA");
      sair();
      await screen.findByText("Outra tela");
      expect(windows.confirm).not.toHaveBeenCalled();
    });

    it("alterar a sugestão pede confirmação, e voltar a ela não", async () => {
      apiFetch.mockResolvedValue(sugerida);
      render(<ColaboradoresPage />);
      const row = await linha("ANA SOUZA");
      await escolherUsuario(row, "Bia Lima");
      windows.confirm.mockResolvedValue(false);
      await expect(confirmLeave()).resolves.toBe(false);
      expect(windows.confirm).toHaveBeenCalledTimes(1);

      await escolherUsuario(row, "Ana Souza");
      await expect(confirmLeave()).resolves.toBe(true);
      expect(windows.confirm).toHaveBeenCalledTimes(1);
    });
  });

  it("um rascunho guarda a version de quando começou: recarregar por conflito em outra linha não a atualiza", async () => {
    const ativas = lista.colaboradores.map((c) => ({ ...c, ativo: true }));
    apiFetch.mockResolvedValueOnce({ ...lista, colaboradores: ativas });
    render(<ColaboradoresPage />);
    await escolherUsuario(await linha("ANA SOUZA"), "Ana Souza");
    await escolherUsuario(await linha("BRUNO LIMA"), "Bia Lima");

    apiFetch.mockRejectedValueOnce(new ApiError("Alterado.", 409, "versao_desatualizada"));
    apiFetch.mockResolvedValueOnce({ ...lista, colaboradores: ativas.map((c) => ({ ...c, version: 5 })) });
    fireEvent.click(botao(await linha("ANA SOUZA"), "Confirmar"));
    await waitFor(() => expect(feedback.notify).toHaveBeenCalled());
    await waitFor(async () => expect(campoUsuario(await linha("ANA SOUZA")).value).toBe(""));

    apiFetch.mockRejectedValueOnce(new ApiError("Alterado.", 409, "versao_desatualizada"));
    apiFetch.mockResolvedValueOnce({ ...lista, colaboradores: ativas.map((c) => ({ ...c, version: 5 })) });
    fireEvent.click(botao(await linha("BRUNO LIMA"), "Confirmar"));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      "/api/m/inovafarma/colaboradores/9/vinculo",
      expect.objectContaining({ body: JSON.stringify({ usuarioId: "bia", lojas: [], version: 0 }) }),
    ));
    await waitFor(() => expect(feedback.notify).toHaveBeenCalledTimes(2));
  });

  it("um rascunho desfeito não pede confirmação", async () => {
    await abrirComRascunho();
    fireEvent.click(within(await linha("ANA SOUZA")).getByRole("button", { name: "Limpar Usuário" }));
    await waitFor(async () => expect(campoUsuario(await linha("ANA SOUZA")).value).toBe(""));
    sair();
    await screen.findByText("Outra tela");
    expect(windows.confirm).not.toHaveBeenCalled();
  });

  it("com alterações, confirmar a saída descarta o rascunho e sai", async () => {
    await abrirComRascunho();
    windows.confirm.mockResolvedValue(true);
    sair();
    await screen.findByText("Outra tela");
    expect(windows.confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("ANA SOUZA")).toBeNull();
  });

  it("com alterações, cancelar a saída fica na tela com o rascunho", async () => {
    await abrirComRascunho();
    windows.confirm.mockResolvedValue(false);
    sair();
    await waitFor(() => expect(windows.confirm).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByText("Outra tela")).toBeNull();
    expect(campoUsuario(await linha("ANA SOUZA")).value).toBe("Ana Souza");
  });

  it("depois de gravar, sai sem pedir confirmação", async () => {
    await abrirComRascunho();
    apiFetch.mockResolvedValue(vinculadoAna);
    fireEvent.click(botao(await linha("ANA SOUZA"), "Confirmar"));
    await within(await linha("ANA SOUZA")).findByText("Confirmado");
    sair();
    await screen.findByText("Outra tela");
    expect(windows.confirm).not.toHaveBeenCalled();
  });

  it("avisa o navegador ao fechar ou recarregar só com alterações", async () => {
    const fechar = () => {
      const evento = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(evento);
      return evento.defaultPrevented;
    };
    await abrirComRascunho();
    expect(fechar()).toBe(true);
    cleanup();
    expect(fechar()).toBe(false);
  });

  it("encerrar a sessão pergunta antes só se houver alterações", async () => {
    apiFetch.mockResolvedValue(lista);
    render(<ColaboradoresPage />);
    await screen.findByText("ANA SOUZA");
    await expect(confirmLeave()).resolves.toBe(true);
    expect(windows.confirm).not.toHaveBeenCalled();

    await escolherUsuario(await linha("ANA SOUZA"), "Ana Souza");
    windows.confirm.mockResolvedValue(false);
    await expect(confirmLeave()).resolves.toBe(false);
    expect(windows.confirm).toHaveBeenCalledTimes(1);
  });
});
