// @vitest-environment jsdom
import React from "react";
import { Button } from "@platform/ui/components/button";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Text } from "@platform/ui/components/layout";
import { AuthProvider, useAuth } from "./AuthContext";
import { api } from "@/lib/api-client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const me = { sub: "u1", username: "maria", fullname: "Maria", permissions: [], role: "gestor" };

function Probe() {
  const { isAuthenticated, isLoading } = useAuth();
  return <Text>{isLoading ? "carregando" : isAuthenticated ? "logado" : "deslogado"}</Text>;
}

function LoginProbe() {
  const { isAuthenticated, isLoading, login, loginWithCertificate } = useAuth();
  const [result, setResult] = React.useState("");
  return (
    <>
      <Text>{isLoading ? "carregando" : isAuthenticated ? "logado" : "deslogado"}</Text>
      <Text>{result}</Text>
      <Button onClick={() => login("maria", "Senha@123").then((r) => setResult(r.certificateUrl ?? "sem certificado"))}>entrar</Button>
      <Button onClick={() => loginWithCertificate("desafio", "codigo").then(() => setResult("voltou"))}>concluir</Button>
    </>
  );
}

afterEach(() => {
  cleanup();
  api.setAccessToken(null);
  vi.unstubAllGlobals();
});

describe("AuthProvider", () => {
  it("faz logout no cliente quando o servidor recusa renovar a sessão", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (path: string) => {
      calls.push(path);
      if (path === "/api/auth/me") return calls.filter((p) => p === "/api/auth/me").length === 1 ? json(200, me) : json(401, { error: "expirou" });
      if (path === "/api/auth/refresh") return json(401, { error: "Dispositivo não autorizado." });
      return json(401, { error: "expirou" });
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("logado")).toBeTruthy();

    await expect(api.iam.listDevices()).rejects.toThrow();

    await waitFor(() => expect(screen.getByText("deslogado")).toBeTruthy());
  });

  it("quem exige certificado recebe o endereço da autoridade em vez de entrar, e conclui o login com o código", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      if (path === "/api/auth/me") return json(401, { error: "sem sessão" });
      if (path === "/api/auth/refresh") return json(401, { error: "sem sessão" });
      bodies.push([path, init?.body]);
      if (path === "/api/auth/login") return json(200, { certificateRequired: true, verifyUrl: "https://acesso.exemplo.com/verify?challenge=desafio" });
      if (path === "/api/auth/login/certificate") return json(200, { accessToken: "t", refreshToken: "r", expiresIn: 300, user: me });
      return json(404, {});
    });
    render(
      <AuthProvider>
        <LoginProbe />
      </AuthProvider>,
    );
    await screen.findByText("deslogado");

    fireEvent.click(screen.getByRole("button", { name: "entrar" }));
    expect(await screen.findByText("https://acesso.exemplo.com/verify?challenge=desafio")).toBeTruthy();
    expect(screen.getByText("deslogado")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "concluir" }));
    expect(await screen.findByText("logado")).toBeTruthy();
    expect(bodies).toContainEqual(["/api/auth/login/certificate", JSON.stringify({ challengeId: "desafio", code: "codigo" })]);
  });

  it("o login que termina enquanto a restauração da sessão ainda falha não é desfeito", async () => {
    let failRestore!: () => void;
    let restoring = true;
    vi.stubGlobal("fetch", async (path: string) => {
      if (path === "/api/auth/me") {
        if (!restoring) return json(200, me); // repetida com o token do login
        // A restauração do início da página: ainda sem token, falha só depois do login.
        restoring = false;
        await new Promise<void>((resolve) => (failRestore = resolve));
        return json(401, { error: "sem sessão" });
      }
      if (path === "/api/auth/refresh") return json(401, { error: "sem sessão" });
      if (path === "/api/auth/login/certificate") return json(200, { accessToken: "t", refreshToken: "r", expiresIn: 300, user: me });
      return json(404, {});
    });
    render(
      <AuthProvider>
        <LoginProbe />
      </AuthProvider>,
    );
    await vi.waitFor(() => expect(typeof failRestore).toBe("function"));

    fireEvent.click(screen.getByRole("button", { name: "concluir" }));
    await screen.findByText("voltou");
    failRestore();

    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() => expect(screen.getByText("logado")).toBeTruthy());
    expect(screen.getByText("logado")).toBeTruthy();
  });
});
