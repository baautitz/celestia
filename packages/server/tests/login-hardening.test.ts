import { describe, it, expect, afterEach, vi } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { LoginRateLimiter } from "../src/iam/login-rate-limiter.js";
import { createSeededUserStore, TEST_PASSWORD } from "./helpers/fixtures.js";

const envFor = (ip: string) => ({ incoming: { socket: { remoteAddress: ip } } });

function setup(limiter?: LoginRateLimiter) {
  const app = createPlatformApp({ userStore: createSeededUserStore(), loginRateLimiter: limiter });
  const login = (username: string, password: string, ip = "10.0.0.1") =>
    app.request(
      "/api/auth/login",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) },
      envFor(ip),
    );
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
    const { login } = setup(new LoginRateLimiter({ maxPerUsername: 3, maxPerIp: 100 }));
    for (let i = 0; i < 3; i++) expect((await login("carlos.admin", "errada", `10.0.0.${i}`)).status).toBe(401);
    const res = await login("carlos.admin", TEST_PASSWORD, "10.0.9.9");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("resposta de bloqueio é idêntica para username existente e inexistente", async () => {
    const { login } = setup(new LoginRateLimiter({ maxPerUsername: 2, maxPerIp: 100 }));
    for (const u of ["carlos.admin", "fantasma"]) for (let i = 0; i < 2; i++) await login(u, "errada", `10.1.0.${i}`);
    const a = await login("carlos.admin", "x", "10.2.0.1");
    const b = await login("fantasma", "x", "10.2.0.2");
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(await a.text()).toBe(await b.text());
  });

  it("bloqueia o IP após falhas em usernames diferentes", async () => {
    const { login } = setup(new LoginRateLimiter({ maxPerUsername: 100, maxPerIp: 3 }));
    for (let i = 0; i < 3; i++) await login(`u${i}`, "errada", "10.3.0.1");
    expect((await login("carlos.admin", TEST_PASSWORD, "10.3.0.1")).status).toBe(429);
    expect((await login("carlos.admin", TEST_PASSWORD, "10.3.0.2")).status).toBe(200);
  });

  it("login com sucesso zera o contador do username", async () => {
    const { login } = setup(new LoginRateLimiter({ maxPerUsername: 3, maxPerIp: 100 }));
    await login("carlos.admin", "errada");
    await login("carlos.admin", "errada");
    expect((await login("carlos.admin", TEST_PASSWORD)).status).toBe(200);
    await login("carlos.admin", "errada");
    await login("carlos.admin", "errada");
    expect((await login("carlos.admin", TEST_PASSWORD)).status).toBe(200);
  });

  it("libera após a janela expirar", async () => {
    let now = 0;
    const { login } = setup(new LoginRateLimiter({ maxPerUsername: 2, maxPerIp: 100, windowMs: 1000, now: () => now }));
    await login("carlos.admin", "errada");
    await login("carlos.admin", "errada");
    expect((await login("carlos.admin", TEST_PASSWORD)).status).toBe(429);
    now = 1001;
    expect((await login("carlos.admin", TEST_PASSWORD)).status).toBe(200);
  });
});
