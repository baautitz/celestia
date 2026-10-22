import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { loadModules } from "@platform/core/loader";
import { createIamModule } from "../src/iam/iam-module.js";
import { TokenService } from "../src/iam/token-service.js";
import { createAuthMiddleware } from "../src/iam/middleware.js";
import { createSeededUserStore } from "./helpers/fixtures.js";
import { MemoryConnectionStore } from "../src/data/connection-store.js";

const quiet = { info() {}, warn() {}, error() {} };

async function boot() {
  const userStore = createSeededUserStore();
  const tokenService = new TokenService();
  const mod = createIamModule({
    userStore,
    connectionStore: new MemoryConnectionStore(),
    tokenService,
    auth: createAuthMiddleware(tokenService, (p) => p),
    withAdminBypass: (p) => p,
  });
  const app = new Hono();
  const result = await loadModules(app, [mod], { logger: quiet });
  return { app, mod, result };
}

describe("módulo iam (autenticação)", () => {
  it("é carregado pelo Core e é dono de /api/auth", async () => {
    const { mod, result } = await boot();
    expect(mod.id).toBe("iam");
    expect(mod.prefix).toBe("/api");
    expect(result.loaded).toEqual(["iam"]);
  });

  it("login, me, refresh e logout respondem nas URLs públicas", async () => {
    const { app } = await boot();
    const bad = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: "x" }),
    });
    expect(bad.status).toBe(401);
    expect((await app.request("/api/auth/me")).status).toBe(401);
    expect((await app.request("/api/auth/refresh", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/auth/logout", { method: "POST" })).status).toBe(200);
  });
});
