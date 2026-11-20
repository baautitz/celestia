import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { TokenService } from "../src/iam/token-service.js";
import { createAuthMiddleware, requireAdmin } from "../src/iam/middleware.js";

const tokens = new TokenService({ jwtSecret: "s".repeat(32) });
const user = (isAdmin: boolean) => ({
  id: "u1",
  fullname: "Ana Souza",
  username: "ana",
  roleId: "r",
  status: "active" as const,
  isAdmin,
});
const bearer = async (isAdmin: boolean) => ({
  Authorization: `Bearer ${(await tokens.generateAccessToken(user(isAdmin), { id: "r", name: "R", permissions: [] })).token}`,
});

describe("createAuthMiddleware", () => {
  it("erro dos handlers seguintes não vira 401", async () => {
    const app = new Hono();
    app.onError(() => new Response("boom", { status: 500 }));
    app.get("/x", createAuthMiddleware(tokens), () => {
      throw new Error("falha no handler");
    });
    expect((await app.request("/x", { headers: await bearer(false) })).status).toBe(500);
    expect((await app.request("/x", { headers: { Authorization: "Bearer lixo" } })).status).toBe(401);
  });
});

describe("requireAdmin", () => {
  const app = new Hono();
  app.get("/x", createAuthMiddleware(tokens), requireAdmin("Somente administradores."), (c) => c.json({ ok: true }));

  it("deixa o administrador passar e nega os demais com 403", async () => {
    expect((await app.request("/x", { headers: await bearer(true) })).status).toBe(200);
    const denied = await app.request("/x", { headers: await bearer(false) });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Somente administradores." });
  });
});
