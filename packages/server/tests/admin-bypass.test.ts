import { describe, it, expect, beforeEach } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { MemoryUserStore } from "../src/iam/user-store.js";
import { PasswordService } from "../src/iam/password-service.js";
import { TEST_PASSWORD } from "./helpers/fixtures.js";

const validSource = (id: string) => `
import { defineRecipe } from "@platform/shared";
export default defineRecipe({
  id: "${id}", name: "Modelo", workspace: { params: [] }, sources: {}, actions: [],
  ui: { layout: { type: "grid", columns: 12, gap: 16 }, components: [] },
});
`;

describe("Flag isAdmin (bypass de permissões)", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let store: MemoryUserStore;

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
    const base = { fullname: "x", passwordHash: hash, roleId: "role_vazio", externals: {}, status: "active" as const, createdAt: new Date().toISOString() };
    store = new MemoryUserStore({
      roles: [{ id: "role_vazio", name: "Vazio", permissions: [] }],
      users: [
        { ...base, id: "u1", username: "chefe" },
        { ...base, id: "u2", username: "comum" },
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

    const put = await call("/api/admin/recipes/novo", admin.access_token, { method: "PUT", body: JSON.stringify({ source: validSource("novo") }) });
    expect(put.status).toBe(200);
  });

  it("vale na hora para Modelos criados depois do login", async () => {
    const admin = await login("chefe");
    await call("/api/admin/recipes/novo", admin.access_token, { method: "PUT", body: JSON.stringify({ source: validSource("novo") }) });

    const catalog = (await (await call("/api/recipes", admin.access_token)).json()) as { id: string }[];
    expect(catalog.map((r) => r.id)).toContain("novo");
    const schema = await call("/api/dashboards/novo/schema", admin.access_token);
    expect(schema.status).toBe(200);

    const me = (await (await call("/api/auth/me", admin.access_token)).json()) as { permissions: string[]; isAdmin: boolean };
    expect(me.isAdmin).toBe(true);
    expect(me.permissions).toContain("recipe:novo:view");
    expect(me.permissions).toContain("system:users:create");
  });

  it("o login já devolve as permissões expandidas ao frontend", async () => {
    const admin = await login("chefe");
    expect(admin.user.permissions).toContain("system:sources:manage");
    expect((await login("comum")).user.permissions).toEqual([]);
  });

  it("a API de usuários não consegue conceder isAdmin", async () => {
    const admin = await login("chefe");
    const created = await call("/api/iam/users", admin.access_token, {
      method: "POST",
      body: JSON.stringify({ fullname: "Novo", username: "novo", password: "Senha@1234", roleId: "role_vazio", isAdmin: true }),
    });
    expect([200, 201]).toContain(created.status);
    expect((await store.findByUsername("novo"))!.isAdmin).toBeFalsy();

    const upd = await call("/api/iam/users/u2", admin.access_token, { method: "PUT", body: JSON.stringify({ isAdmin: true }) });
    expect(upd.status).toBeLessThan(500);
    expect((await store.findById("u2"))!.isAdmin).toBeFalsy();
  });
});
