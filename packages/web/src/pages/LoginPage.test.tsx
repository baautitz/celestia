// @vitest-environment jsdom
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginPage } from "./LoginPage";

const login = vi.fn<(u: string, p: string) => Promise<{ certificateUrl?: string }>>();
const notify = vi.fn();

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ login, isAuthenticated: false }) }));
vi.mock("@platform/ui/imperative/provider", () => ({ useUi: () => ({ feedback: { notify } }) }));

afterEach(() => {
  cleanup();
  login.mockReset();
  notify.mockReset();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );

describe("LoginPage", () => {
  it("pede usuário e senha antes de enviar", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Informe o nome de usuário")).toBeTruthy();
    expect(screen.getByText("Informe a senha")).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  it("envia as credenciais digitadas", async () => {
    login.mockResolvedValue({});
    renderPage();
    fireEvent.change(screen.getByLabelText("Usuário"), { target: { value: "maria" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha@123" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("maria", "Senha@123"));
  });

  it("recusa um endereço de certificado que não seja https", async () => {
    login.mockResolvedValue({ certificateUrl: "javascript:alert(1)" });
    renderPage();
    fireEvent.change(screen.getByLabelText("Usuário"), { target: { value: "maria" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha@123" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith({ type: "error", title: "Endereço de verificação do certificado inválido." }),
    );
  });
});
