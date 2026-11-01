// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CriarUsuarioWindow } from "./criar-usuario-window";

vi.mock("@platform/ui/imperative/provider", () => ({ useUi: () => ({ feedback: { notify: vi.fn(), notifyError: vi.fn() } }) }));
vi.mock("@platform/ui/imperative/use-window", () => ({
  useWindow: () => ({ resolve: vi.fn() }),
  WindowActions: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  WindowCancelButton: () => null,
}));

const grupos = [{ id: "g1", name: "Gestor" }];
const username = () => screen.getByLabelText("Nome de Usuário") as HTMLInputElement;

afterEach(cleanup);

describe("CriarUsuarioWindow", () => {
  it("sugere o username a partir do Colaborador e deixa o Grupo sem seleção", () => {
    render(<CriarUsuarioWindow fullname="JOSÉ DA CONCEIÇÃO SILVA" grupos={grupos} />);
    expect(username().value).toBe("jose_conceicao");
    expect(screen.getByText("Selecione")).toBeTruthy();
    expect(screen.queryByText("Gestor")).toBeNull();
  });

  it("o username acompanha o Nome Completo até ser editado à mão", async () => {
    render(<CriarUsuarioWindow fullname="ANTONY MARQUES" grupos={grupos} />);
    fireEvent.change(screen.getByLabelText("Nome Completo"), { target: { value: "ANTONY MARQUES LIMA" } });
    fireEvent.change(screen.getByLabelText("Nome Completo"), { target: { value: "TONY SOUZA" } });
    await waitFor(() => expect(username().value).toBe("tony_souza"));

    fireEvent.change(username(), { target: { value: "tony" } });
    fireEvent.change(screen.getByLabelText("Nome Completo"), { target: { value: "ANTONIO LIMA" } });
    expect(username().value).toBe("tony");
  });
});
