import { describe, it, expect, beforeEach } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { PasswordService } from "../src/iam/password-service.js";
import { TEST_PASSWORD, TestUserStore } from "./helpers/fixtures.js";

describe("Flag isAdmin (bypass de permissões)", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let store: TestUserStore;

  async function login(username: string) {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: TEST_PASSWORD }),
    });
    return (await res.json()) as { access_token: string; user: { permissions: string[] } };
  }

  const call = (path: string, token: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers } });

  beforeEach(async () => {
    // Os dois usuários têm um grupo SEM nenhuma permissão; só um deles é admin.
    const hash = PasswordService.hash(TEST_PASSWORD);
    const base = { fullname: "x", passwordHash: hash, roleId: "role_vazio", status: "active" as const, createdAt: new Date().toISOString() };
    store = new TestUserStore({
      roles: [
        { id: "role_vazio", name: "Vazio", permissions: [] },
        { id: "role_gestor", name: "Gestor", permissions: ["system:users:update"] },
      ],
      users: [
        { ...base, id: "u1", username: "chefe" },
        { ...base, id: "u2", username: "comum" },
        { ...base, id: "u3", username: "gestor", roleId: "role_gestor" },
      ],
    });
    await store.setAdmin("u1", true);
    app = createPlatformApp({ userStore: store });
  });

  it("admin acessa rotas protegidas sem ter nenhuma permissão no grupo; o comum não", async () => {
    const admin = await login("chefe");
    const comum = await login("comum");

    expect((await call("/api/iam/users", admin.access_token)).status).toBe(200);
    expect((await call("/api/iam/users", comum.access_token)).status).toBe(403);
    expect((await call("/api/admin/erps", admin.access_token)).status).toBe(200);
    expect((await call("/api/admin/erps", comum.access_token)).status).toBe(403);
  });

  it("o token do admin carrega todas as chaves do sistema", async () => {
    const admin = await login("chefe");
    const me = (await (await call("/api/auth/me", admin.access_token)).json()) as { permissions: string[]; isAdmin: boolean };
    expect(me.isAdmin).toBe(true);
    expect(me.permissions).toContain("*");
    expect(me.permissions).toContain("system:users:create");
    expect(me.permissions.some((p) => p.startsWith("recipe:"))).toBe(false);
  });

  it("o login já devolve as permissões expandidas ao frontend", async () => {
    const admin = await login("chefe");
    expect(admin.user.permissions).toContain("system:erps:manage");
    expect((await login("comum")).user.permissions).toEqual([]);
  });

  it("a criação de usuário ignora isAdmin", async () => {
    const admin = await login("chefe");
    const created = await call("/api/iam/users", admin.access_token, {
      method: "POST",
      body: JSON.stringify({ fullname: "Novo", username: "novo", password: "Senha@1234", roleId: "role_vazio", isAdmin: true }),
    });
    expect([200, 201]).toContain(created.status);
    expect((await store.findByUsername("novo"))!.isAdmin).toBeFalsy();
  });

  it("só um administrador altera isAdmin, e ninguém se rebaixa", async () => {
    const put = (token: string, id: string, isAdmin: boolean) =>
      call(`/api/iam/users/${id}`, token, { method: "PUT", body: JSON.stringify({ isAdmin }) });

    // Quem tem system:users:update mas não é admin não consegue conceder.
    const gestor = await login("gestor");
    expect((await put(gestor.access_token, "u2", true)).status).toBe(403);
    expect((await store.findById("u2"))!.isAdmin).toBeFalsy();

    const admin = await login("chefe");
    expect((await put(admin.access_token, "u2", true)).status).toBe(200);
    expect((await store.findById("u2"))!.isAdmin).toBe(true);
    expect((await put(admin.access_token, "u2", false)).status).toBe(200);
    expect((await store.findById("u2"))!.isAdmin).toBeFalsy();

    expect((await put(admin.access_token, "u1", false)).status).toBe(400);
    expect((await store.findById("u1"))!.isAdmin).toBe(true);
  });
});
