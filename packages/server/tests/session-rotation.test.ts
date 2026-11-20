import { describe, it, expect } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { createSeededUserStore, refreshTokenOf, TEST_PASSWORD } from "./helpers/fixtures.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const GRACE_MS = 30_000;

function setup() {
  let now = Date.parse("2026-11-20T10:00:00Z");
  const store = createSeededUserStore({ admin: true });
  const app = createPlatformApp({ userStore: store, now: () => now });
  const advance = (ms: number) => {
    now += ms;
  };
  const login = async () =>
    refreshTokenOf(
      await app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username: "test.root", password: TEST_PASSWORD }) }),
    );
  const refresh = (token: string) => app.request("/api/auth/refresh", { method: "POST", headers: { Cookie: `refresh_token=${token}` } });
  const unlock = (token: string, password: string) =>
    app.request("/api/auth/unlock", { method: "POST", headers: { ...JSON_HEADERS, Cookie: `refresh_token=${token}` }, body: JSON.stringify({ password }) });
  const lock = (token?: string) =>
    app.request("/api/auth/lock", { method: "POST", headers: token ? { Cookie: `refresh_token=${token}` } : {} });
  return { app, advance, login, refresh, unlock, lock };
}

describe("refresh token opaco com rotação", () => {
  it("o token antigo, reapresentado depois da janela, revoga a família inteira", async () => {
    const { advance, login, refresh } = setup();
    const first = await login();
    const rotated = await refresh(first);
    expect(rotated.status).toBe(200);
    const second = refreshTokenOf(rotated);
    expect(second).not.toBe(first);

    advance(GRACE_MS + 1);
    expect((await refresh(first)).status).toBe(401);
    expect((await refresh(second)).status).toBe(401);
  });

  it("reapresentar o token dentro da janela de tolerância não derruba a sessão (abas simultâneas)", async () => {
    const { advance, login, refresh } = setup();
    const first = await login();
    const a = await refresh(first);
    advance(GRACE_MS - 1);
    const b = await refresh(first);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await refresh(refreshTokenOf(b))).status).toBe(200);
  });

  it("o token em claro nunca é guardado: o cookie é um valor opaco, não um JWT", async () => {
    const { login } = setup();
    expect((await login()).split(".")).toHaveLength(1);
  });

  it("o cookie é de sessão: sem Max-Age nem Expires", async () => {
    const { app } = setup();
    const res = await app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username: "test.root", password: TEST_PASSWORD }) });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
  });

  it("logout revoga só a sessão atual: outra sessão do mesmo usuário segue", async () => {
    const { app, login, refresh } = setup();
    const mine = await login();
    const other = await login();
    await app.request("/api/auth/logout", { method: "POST", headers: { Cookie: `refresh_token=${mine}` } });
    expect((await refresh(mine)).status).toBe(401);
    expect((await refresh(other)).status).toBe(200);
  });

  it("a sessão acaba no limite absoluto, mesmo renovando sem parar", async () => {
    const { advance, login, refresh } = setup();
    let token = await login();
    for (let i = 0; i < 24; i++) {
      advance(29 * 60_000);
      const res = await refresh(token);
      expect(res.status).toBe(200);
      token = refreshTokenOf(res);
    }
    advance(29 * 60_000);
    expect((await refresh(token)).status).toBe(401);
  });

  it("a sessão parada além do limite de inatividade não renova", async () => {
    const { advance, login, refresh } = setup();
    const token = await login();
    advance(30 * 60_000 + 1);
    expect((await refresh(token)).status).toBe(401);
  });

  it("a sessão ociosa recusa renovar com o código session_locked, sem revogar a sessão", async () => {
    const { advance, login, refresh, unlock } = setup();
    const token = await login();
    advance(30 * 60_000 + 1);
    const res = await refresh(token);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe("session_locked");
    expect((await unlock(token, TEST_PASSWORD)).status).toBe(200);
  });
});

describe("desbloqueio com a senha", () => {
  it("a senha certa devolve a sessão (token novo) sem novo login", async () => {
    const { advance, login, refresh, unlock } = setup();
    const token = await login();
    advance(30 * 60_000 + 1);
    const res = await unlock(token, TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { accessToken?: string }).accessToken).toBeTruthy();
    expect((await refresh(refreshTokenOf(res))).status).toBe(200);
  });

  it("a senha errada é recusada e a sessão segue bloqueada", async () => {
    const { advance, login, refresh, unlock } = setup();
    const token = await login();
    advance(30 * 60_000 + 1);
    expect((await unlock(token, "errada")).status).toBe(401);
    expect((await refresh(token)).status).toBe(401);
  });

  it("depois de 5 senhas erradas, bloqueia as tentativas e revoga a sessão", async () => {
    const { advance, login, unlock } = setup();
    const token = await login();
    advance(30 * 60_000 + 1);
    for (let i = 0; i < 5; i++) expect((await unlock(token, "errada")).status).toBe(401);
    expect((await unlock(token, TEST_PASSWORD)).status).toBe(401);
  });

  it("não desbloqueia uma sessão além do limite absoluto", async () => {
    const { advance, login, unlock } = setup();
    const token = await login();
    advance(12 * 3600_000 + 1);
    expect((await unlock(token, TEST_PASSWORD)).status).toBe(401);
  });

  it("sem cookie não há o que desbloquear", async () => {
    const { app } = setup();
    const res = await app.request("/api/auth/unlock", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ password: TEST_PASSWORD }) });
    expect(res.status).toBe(401);
  });
});

describe("bloqueio avisado pelo cliente", () => {
  it("sessão bloqueada recusa renovar (recarregar a página não destrava) até a senha", async () => {
    const { login, refresh, unlock, lock } = setup();
    const token = await login();
    expect((await lock(token)).status).toBe(200);

    const res = await refresh(token);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string; user?: { fullname: string; username: string } };
    expect(body.code).toBe("session_locked");
    // Quem está bloqueado: a janela de senha mostra o nome, inclusive ao recarregar a página (sem usuário no cliente).
    expect(body.user?.username).toBe("test.root");
    expect(body.user).not.toHaveProperty("passwordHash");

    const unlocked = await unlock(token, TEST_PASSWORD);
    expect(unlocked.status).toBe(200);
    expect((await refresh(refreshTokenOf(unlocked))).status).toBe(200);
  });

  it("bloquear sem sessão (sem cookie) é recusado", async () => {
    const { lock } = setup();
    expect((await lock()).status).toBe(401);
  });

  it("bloquear de novo uma sessão já bloqueada é inofensivo", async () => {
    const { login, lock, unlock } = setup();
    const token = await login();
    await lock(token);
    expect((await lock(token)).status).toBe(200);
    expect((await unlock(token, TEST_PASSWORD)).status).toBe(200);
  });
});

