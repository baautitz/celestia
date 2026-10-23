import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { loadModules } from "@platform/core/loader";
import { createIamModule } from "../src/iam/iam-module.js";
import { TokenService } from "../src/iam/token-service.js";
import { createAuthMiddleware } from "../src/iam/middleware.js";
import { createSeededUserStore, TEST_PASSWORD } from "./helpers/fixtures.js";

const quiet = { info() {}, warn() {}, error() {} };
const json = { "Content-Type": "application/json" };

async function boot() {
  const userStore = createSeededUserStore();
  const tokenService = new TokenService();
  const mod = createIamModule({
    userStore,
    tokenService,
    auth: createAuthMiddleware(tokenService, (p) => p),
    withAdminBypass: (p) => p,
  });
  const app = new Hono();
  const result = await loadModules(app, [mod], { logger: quiet });
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ username: "carlos.admin", password: TEST_PASSWORD }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const authed = { ...json, Authorization: `Bearer ${accessToken}` };
  return { app, mod, result, authed };
}

describe("módulo iam: permissões declaradas", () => {
  it("declara as permissões de Users e Roles com as chaves system:*", async () => {
    const { mod, result } = await boot();
    const keys = (mod.permissions?.items ?? []).map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining(["system:users:create", "system:users:reset_password", "system:roles:read", "system:roles:update"]),
    );
    expect(keys).not.toContain("system:roles:delete");
    expect(result.registry.allKeys().has("system:users:create")).toBe(true);
  });
});

describe("módulo iam: eventos", () => {
  it("emite after em criar, alterar, reset e excluir usuário e em Roles, sem passwordHash", async () => {
    const { app, result, authed } = await boot();
    const seen: Record<string, object> = {};
    for (const e of ["iam.user.create", "iam.user.update", "iam.user.reset_password", "iam.user.delete", "iam.role.create", "iam.role.update"]) {
      result.events.after(e, (p) => void (seen[e] = p));
    }
    const created = await app.request("/api/iam/users", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({ fullname: "Novo Usuario", username: "novo.user", password: TEST_PASSWORD, roleId: "role_vendedor" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    await app.request(`/api/iam/users/${id}`, { method: "PUT", headers: authed, body: JSON.stringify({ fullname: "Outro Nome" }) });
    await app.request(`/api/iam/users/${id}/reset-password`, { method: "POST", headers: authed, body: JSON.stringify({ newPassword: "Nova@12345" }) });
    await app.request(`/api/iam/users/${id}`, { method: "DELETE", headers: authed });
    await app.request("/api/iam/roles", { method: "POST", headers: authed, body: JSON.stringify({ id: "r_x", name: "Grupo X", permissions: ["system:users:read"] }) });
    await app.request("/api/iam/roles/r_x", { method: "PUT", headers: authed, body: JSON.stringify({ name: "Grupo Y" }) });

    expect(Object.keys(seen).sort()).toEqual(
      ["iam.role.create", "iam.role.update", "iam.user.create", "iam.user.delete", "iam.user.reset_password", "iam.user.update"].sort(),
    );
    expect(JSON.stringify(seen)).not.toMatch(/passwordHash|argon2/);
    expect(JSON.stringify(seen)).not.toContain("Nova@12345");
    expect(seen["iam.user.create"]).toMatchObject({ actorId: "usr_1001" });
  });

  it("emite iam.login somente após login válido", async () => {
    const { app, result } = await boot();
    const logins: object[] = [];
    result.events.after("iam.login", (p) => void logins.push(p));
    await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "joao.silva", password: TEST_PASSWORD }) });
    await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "joao.silva", password: "errada" }) });
    expect(logins).toHaveLength(1);
    expect(logins[0]).toMatchObject({ userId: "usr_1002", username: "joao.silva" });
  });

  it("um before que cancela impede a ação e responde 409 com o motivo", async () => {
    const { app, result, authed } = await boot();
    result.events.before("iam.user.create", (ctx) => ctx.cancel("bloqueado pelo teste"));
    const res = await app.request("/api/iam/users", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({ fullname: "Novo Usuario", username: "novo.user", password: TEST_PASSWORD, roleId: "role_vendedor" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "bloqueado pelo teste" });
    const list = (await (await app.request("/api/iam/users", { headers: authed })).json()) as { username: string }[];
    expect(list.some((u) => u.username === "novo.user")).toBe(false);
  });
});
