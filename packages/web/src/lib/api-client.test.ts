// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api-client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fetchMock = vi.fn<(path: string) => Promise<Response>>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  api.setAccessToken("expirado");
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  api.onSessionExpired(null);
});

describe("sessão encerrada pelo servidor", () => {
  it("avisa quando a renovação é recusada (ex.: o Dispositivo foi revogado)", async () => {
    const expired = vi.fn();
    api.onSessionExpired(expired);
    fetchMock.mockImplementation(async (path) => (path === "/api/auth/refresh" ? json(401, { error: "Este acesso exige um Dispositivo homologado. Fale com um administrador." }) : json(401, { error: "Não autorizado" })));

    await expect(api.iam.listDevices()).rejects.toThrow();

    expect(expired).toHaveBeenCalledTimes(1);
    expect(api.getAccessToken()).toBeNull();
  });

  it("não avisa quando a renovação funciona, e repete a requisição", async () => {
    const expired = vi.fn();
    api.onSessionExpired(expired);
    let first = true;
    fetchMock.mockImplementation(async (path) => {
      if (path === "/api/auth/refresh") return json(200, { accessToken: "novo" });
      if (first) {
        first = false;
        return json(401, { error: "expirou" });
      }
      return json(200, []);
    });

    expect(await api.iam.listDevices()).toEqual([]);
    expect(expired).not.toHaveBeenCalled();
    expect(api.getAccessToken()).toBe("novo");
  });

  it("avisa uma vez só quando várias requisições falham juntas", async () => {
    const expired = vi.fn();
    api.onSessionExpired(expired);
    fetchMock.mockImplementation(async () => json(401, { error: "recusado" }));

    await Promise.allSettled([api.iam.listDevices(), api.iam.listUsers(), api.iam.listRoles()]);

    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("não avisa por falha de rede no meio da renovação", async () => {
    const expired = vi.fn();
    api.onSessionExpired(expired);
    fetchMock.mockImplementation(async (path) => {
      if (path === "/api/auth/refresh") throw new TypeError("Failed to fetch");
      return json(401, { error: "expirou" });
    });

    await expect(api.iam.listDevices()).rejects.toThrow();

    expect(expired).not.toHaveBeenCalled();
  });
});
