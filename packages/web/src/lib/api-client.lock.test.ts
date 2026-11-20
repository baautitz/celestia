// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./api-client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const tokens = (accessToken: string) => ({ accessToken, expiresIn: 300, idleSeconds: 10, user: { sub: "u1", username: "ana", fullname: "Ana", role: "r", permissions: [] } });

describe("bloqueio da sessão no cliente", () => {
  let calls: { path: string; auth: string | null }[];
  let refreshAnswer: () => Response;

  beforeEach(() => {
    calls = [];
    refreshAnswer = () => json(401, { error: "Sessão bloqueada por inatividade.", code: "session_locked" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("Authorization");
        calls.push({ path, auth });
        if (path === "/api/auth/lock") return json(200, { success: true });
        if (path === "/api/auth/refresh") return refreshAnswer();
        if (path === "/api/auth/unlock") {
          const { password } = JSON.parse(String(init?.body)) as { password: string };
          return password === "certa" ? json(200, tokens("novo")) : json(401, { error: "Credenciais inválidas." });
        }
        return auth === "Bearer novo" ? json(200, { ok: path }) : json(401, { error: "expirado" });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renovação que volta bloqueada abre o bloqueio e refaz a requisição pendente depois da senha", async () => {
    const api = new ApiClient();
    const locks: boolean[] = [];
    api.onLockChange((locked) => locks.push(locked));
    api.setAccessToken("velho");

    const pending = api.request<{ ok: string }>("/api/iam/users");
    await vi.waitFor(() => expect(locks).toEqual([true]));
    expect(api.isLocked()).toBe(true);

    await api.auth.unlock("certa");
    await expect(pending).resolves.toEqual({ ok: "/api/iam/users" });
    expect(locks).toEqual([true, false]);
    expect(api.isLocked()).toBe(false);
  });

  it("senha errada mantém o bloqueio e a requisição pendente segue esperando", async () => {
    const api = new ApiClient();
    api.setAccessToken("velho");
    const pending = api.request("/api/iam/users");
    await vi.waitFor(() => expect(api.isLocked()).toBe(true));

    await expect(api.auth.unlock("errada")).rejects.toThrow();
    expect(api.isLocked()).toBe(true);
    await api.auth.unlock("certa");
    await expect(pending).resolves.toBeTruthy();
  });

  it("requisição feita durante o bloqueio espera e não sai sem o token novo", async () => {
    const api = new ApiClient();
    api.setAccessToken("velho");
    api.lock();
    const pending = api.request("/api/iam/roles");
    await Promise.resolve();
    expect(calls.filter((c) => c.path === "/api/iam/roles")).toHaveLength(0);

    await api.auth.unlock("certa");
    await pending;
    expect(calls.find((c) => c.path === "/api/iam/roles")?.auth).toBe("Bearer novo");
  });

  it("o bloqueio apaga o access token da memória", () => {
    const api = new ApiClient();
    api.setAccessToken("velho");
    api.lock();
    expect(api.getAccessToken()).toBeNull();
  });

  it("sair durante o bloqueio solta as requisições pendentes com erro", async () => {
    const api = new ApiClient();
    api.setAccessToken("velho");
    api.lock();
    const pending = api.request("/api/iam/roles");
    const rejected = expect(pending).rejects.toThrow();
    await api.auth.logout();
    await rejected;
    expect(api.isLocked()).toBe(false);
  });

  it("o bloqueio numa aba bloqueia a outra, e o desbloqueio libera as duas", async () => {
    const a = new ApiClient();
    const b = new ApiClient();
    a.setAccessToken("velho");
    b.setAccessToken("velho");
    refreshAnswer = () => json(200, tokens("novo"));

    a.lock();
    await vi.waitFor(() => expect(b.isLocked()).toBe(true));
    await a.auth.unlock("certa");
    await vi.waitFor(() => expect(b.isLocked()).toBe(false));
    expect(b.getAccessToken()).toBe("novo");
  });

  it("bloquear localmente avisa o servidor, para recarregar a página não destravar", async () => {
    const api = new ApiClient();
    api.setAccessToken("velho");
    api.lock();
    await vi.waitFor(() => expect(calls.some((c) => c.path === "/api/auth/lock")).toBe(true));
  });

  it("bloqueio vindo de outra aba não repete o aviso ao servidor", async () => {
    const a = new ApiClient();
    const b = new ApiClient();
    a.setAccessToken("velho");
    b.setAccessToken("velho");
    a.lock();
    await vi.waitFor(() => expect(b.isLocked()).toBe(true));
    expect(calls.filter((c) => c.path === "/api/auth/lock")).toHaveLength(1);
  });

  it("sem rede para avisar, o bloqueio local segue de pé", async () => {
    const api = new ApiClient();
    api.setAccessToken("velho");
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    api.lock();
    await Promise.resolve();
    expect(api.isLocked()).toBe(true);
  });
});

