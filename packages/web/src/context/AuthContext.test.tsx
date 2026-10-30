// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Text } from "@platform/ui/components/layout";
import { AuthProvider, useAuth } from "./AuthContext";
import { api } from "@/lib/api-client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const me = { sub: "u1", username: "maria", fullname: "Maria", permissions: [], role: "gestor" };

function Probe() {
  const { isAuthenticated, isLoading } = useAuth();
  return <Text>{isLoading ? "carregando" : isAuthenticated ? "logado" : "deslogado"}</Text>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuthProvider", () => {
  it("faz logout no cliente quando o servidor recusa renovar a sessão", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (path: string) => {
      calls.push(path);
      if (path === "/api/auth/me") return calls.filter((p) => p === "/api/auth/me").length === 1 ? json(200, me) : json(401, { error: "expirou" });
      if (path === "/api/auth/refresh") return json(401, { error: "Este acesso exige um Dispositivo homologado. Fale com um administrador." });
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
});
