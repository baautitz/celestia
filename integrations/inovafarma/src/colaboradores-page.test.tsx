// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@platform/ui/lib/api";
import { ColaboradoresPage } from "./colaboradores-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const feedback = vi.hoisted(() => ({ notify: vi.fn(), notifyError: vi.fn() }));
vi.mock("@platform/ui/imperative/provider", () => ({ useUi: () => ({ feedback }) }));

const pendente = { confirmado: false, usuarioId: null, usuario: null, version: 0 };
const ana = { id: "ana", fullname: "Ana Souza", username: "ana.souza" };
const bia = { id: "bia", fullname: "Bia Lima", username: "bia.lima" };
const lista = {
  colaboradores: [
    { codigoColaborador: 7, nome: "ANA SOUZA", ativo: true, ...pendente },
    { codigoColaborador: 9, nome: "BRUNO LIMA", ativo: false, ...pendente },
  ],
  usuarios: [ana, bia],
};
const vinculadoAna = { confirmado: true, usuarioId: "ana", usuario: { ...ana, status: "active" }, version: 3 };
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
      body: JSON.stringify({ usuarioId: "bia", version: 0 }),
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
      expect.objectContaining({ body: JSON.stringify({ usuarioId: null, version: 3 }) }),
    );
  });

  it("no 409 avisa, recarrega a linha e descarta a edição dela", async () => {
    apiFetch.mockResolvedValueOnce(lista);
    render(<ColaboradoresPage />);
    const row = await linha("ANA SOUZA");
    await escolherUsuario(row, "Bia Lima");

    apiFetch.mockRejectedValueOnce(new ApiError("O vínculo foi alterado por outra pessoa. A linha foi recarregada.", 409));
    apiFetch.mockResolvedValueOnce(listaComVinculo);
    fireEvent.click(within(row).getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Confirmado")).toBeTruthy();
    expect(feedback.notify).toHaveBeenCalledWith(expect.objectContaining({ description: "O vínculo foi alterado por outra pessoa. A linha foi recarregada.", type: "warning" }));
    expect((screen.getByRole("combobox", { name: "Usuário de ANA SOUZA" }) as HTMLInputElement).value).toBe("Ana Souza");
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
});
