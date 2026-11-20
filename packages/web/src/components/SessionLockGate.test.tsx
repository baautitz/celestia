// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Input } from "@platform/ui/components/input";
import { UiProvider } from "@platform/ui/imperative/provider";
import { AuthProvider } from "@/context/AuthContext";
import { api } from "@/lib/api-client";
import { SessionLockGate } from "./SessionLockGate";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const me = { sub: "u1", username: "maria", fullname: "Maria", permissions: [], role: "gestor" };

function stubServer() {
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path === "/api/auth/me") return json(200, me);
    if (path === "/api/auth/lock") return json(200, { success: true });
    if (path === "/api/auth/unlock") {
      const { password } = JSON.parse(String(init?.body)) as { password: string };
      return password === "Senha@123" ? json(200, { accessToken: "novo", expiresIn: 300, idleSeconds: 1800, user: me }) : json(401, { error: "Credenciais inválidas." });
    }
    return json(404, {});
  });
}

const mount = () =>
  render(
    <AuthProvider>
      <UiProvider>
        <Input aria-label="Observação" />
        <SessionLockGate />
      </UiProvider>
    </AuthProvider>,
  );

afterEach(async () => {
  cleanup();
  // `api` é um singleton: sair solta um bloqueio que o teste tenha deixado para o próximo.
  vi.stubGlobal("fetch", async () => json(200, {}));
  await api.auth.logout();
  api.onLockChange(null);
  vi.unstubAllGlobals();
});

describe("SessionLockGate", () => {
  it("pede a senha por cima da tela, não perde o que estava digitado e libera com a senha certa", async () => {
    stubServer();
    mount();
    const note = (await screen.findByLabelText("Observação")) as HTMLInputElement;
    fireEvent.change(note, { target: { value: "rascunho em andamento" } });

    act(() => api.lock());
    const password = await screen.findByLabelText("Senha");
    expect(screen.getByText("Maria")).toBeTruthy(); // quem está bloqueado
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull(); // sem X: só a senha ou Sair
    fireEvent.change(password, { target: { value: "errada" } });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
    expect(await screen.findByText("Credenciais inválidas.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha@123" } });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
    await waitFor(() => expect(screen.queryByLabelText("Senha")).toBeNull());
    expect(api.isLocked()).toBe(false);
    expect((screen.getByLabelText("Observação") as HTMLInputElement).value).toBe("rascunho em andamento");
  });

  it("Esc não fecha: a janela reabre enquanto a sessão seguir bloqueada", async () => {
    stubServer();
    mount();
    await screen.findByLabelText("Observação");
    act(() => api.lock());
    const password = await screen.findByLabelText("Senha");
    fireEvent.keyDown(password, { key: "Escape" });
    expect(await screen.findByLabelText("Senha")).toBeTruthy();
    expect(api.isLocked()).toBe(true);
  });

  it("recarregar a página com a sessão bloqueada pede a senha antes de a tela carregar", async () => {
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      const authorized = new Headers(init?.headers).get("Authorization") === "Bearer novo";
      if (path === "/api/auth/me") return authorized ? json(200, me) : json(401, { error: "sem token" });
      if (path === "/api/auth/refresh") return json(401, { error: "Sessão bloqueada por inatividade.", code: "session_locked", user: { fullname: "Maria Souza", username: "maria" } });
      if (path === "/api/auth/lock") return json(200, { success: true });
      if (path === "/api/auth/unlock") return json(200, { accessToken: "novo", expiresIn: 300, idleSeconds: 1800, user: me });
      return json(404, {});
    });
    mount();
    const password = await screen.findByLabelText("Senha");
    expect(screen.getByText("Maria Souza")).toBeTruthy();
    fireEvent.change(password, { target: { value: "Senha@123" } });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
    await waitFor(() => expect(screen.queryByLabelText("Senha")).toBeNull());
    expect(api.isLocked()).toBe(false);
  });
});

