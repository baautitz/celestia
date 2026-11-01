import { describe, it, expect, afterEach, vi } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { LoginRateLimiter } from "../src/iam/login-rate-limiter.js";
import { createSeededUserStore, TEST_PASSWORD } from "./helpers/fixtures.js";

function setup(limiter?: LoginRateLimiter) {
  const app = createPlatformApp({ userStore: createSeededUserStore(), loginRateLimiter: limiter });
  const login = (username: string, password: string) =>
    app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  return { login };
}

afterEach(() => vi.unstubAllEnvs());

describe("cookie de refresh", () => {
  it("sai com Secure em produção", async () => {
    const { login } = setup();
    vi.stubEnv("NODE_ENV", "production");
    const res = await login("carlos.admin", TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/;\s*Secure/i);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("sem Secure fora de produção (http local)", async () => {
    const { login } = setup();
    const res = await login("carlos.admin", TEST_PASSWORD);
    expect(res.headers.get("set-cookie")).not.toMatch(/Secure/i);
  });
});

describe("limite de tentativas de login", () => {
  it("bloqueia o username após falhas, mesmo com a senha certa, com 429", async () => {
    const { login } = setup(new LoginRateLimiter({ maxPerUsername: 3 }));
    for (let i = 0; i < 3; i++) expect((await login("carlos.admin", "errada")).status).toBe(401);
    const res = await login("carlos.admin", TEST_PASSWORD);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("resposta de bloqueio é idêntica para username existente e inexistente", async () => {
    const { login } = setup(new LoginRateLimiter({ maxPerUsername: 2 }));
    for (const u of ["carlos.admin", "fantasma"]) for (let i = 0; i < 2; i++) await login(u, "errada");
    const a = await login("carlos.admin", "x");
    const b = await login("fantasma", "x");
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(await a.text()).toBe(await b.text());
  });


  it("login com sucesso zera o contador do username", async () => {
    const { login } = setup(new LoginRateLimiter({ maxPerUsername: 3 }));
    await login("carlos.admin", "errada");
    await login("carlos.admin", "errada");
    expect((await login("carlos.admin", TEST_PASSWORD)).status).toBe(200);
    await login("carlos.admin", "errada");
    await login("carlos.admin", "errada");
    expect((await login("carlos.admin", TEST_PASSWORD)).status).toBe(200);
  });

  it("libera após a janela expirar", async () => {
    let now = 0;
    const { login } = setup(new LoginRateLimiter({ maxPerUsername: 2, windowMs: 1000, now: () => now }));
    await login("carlos.admin", "errada");
    await login("carlos.admin", "errada");
    expect((await login("carlos.admin", TEST_PASSWORD)).status).toBe(429);
    now = 1001;
    expect((await login("carlos.admin", TEST_PASSWORD)).status).toBe(200);
  });
});
