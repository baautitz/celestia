import { describe, it, expect } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { createSeededUserStore, TEST_PASSWORD, withAuth } from "./helpers/fixtures.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function setup() {
  const store = createSeededUserStore({ admin: true });
  await store.createRole({ id: "role_a", name: "A", description: "d", permissions: ["system:users:read"] });
  await store.createRole({ id: "role_b", name: "B", description: "d", permissions: [] });
  const target = await store.createUser({ fullname: "Alvo Teste", username: "alvo", password: TEST_PASSWORD, roleId: "role_a" });
  const app = createPlatformApp({ userStore: store });
  const admin = withAuth(createPlatformApp({ userStore: store }), "test.root");
  const login = async (): Promise<string> => {
    const res = await app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username: "alvo", password: TEST_PASSWORD }) });
    return ((await res.json()) as { refresh_token: string }).refresh_token;
  };
  const refresh = async (token: string) =>
    (await app.request("/api/auth/refresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ refresh_token: token }) })).status;
  const put = (id: string, body: object) =>
    admin.request(`/api/iam/users/${id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(body) });
  return { app, admin, store, target, login, refresh, put };
}

describe("sessões revogáveis", () => {
  it("refresh emitido antes de logout é recusado", async () => {
    const { app, login, refresh } = await setup();
    const token = await login();
    expect(await refresh(token)).toBe(200);
    const fresh = await login();
    const out = await app.request("/api/auth/logout", { method: "POST", headers: { ...JSON_HEADERS, Cookie: `refresh_token=${fresh}` } });
    expect(out.status).toBe(200);
    expect(await refresh(fresh)).toBe(401);
  });

  it("o refresh rotacionado continua válido", async () => {
    const { app, login } = await setup();
    const token = await login();
    const res = await app.request("/api/auth/refresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ refresh_token: token }) });
    const next = ((await res.json()) as { refresh_token: string }).refresh_token;
    const again = await app.request("/api/auth/refresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ refresh_token: next }) });
    expect(again.status).toBe(200);
  });

  it("reset de senha revoga", async () => {
    const { admin, target, login, refresh } = await setup();
    const token = await login();
    const res = await admin.request(`/api/iam/users/${target.id}/reset-password`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ newPassword: "Nova@12345" }) });
    expect(res.status).toBe(200);
    expect(await refresh(token)).toBe(401);
  });

  it("desativação revoga, mesmo após reativar", async () => {
    const { target, login, refresh, put } = await setup();
    const token = await login();
    await put(target.id, { status: "inactive" });
    await put(target.id, { status: "active" });
    expect(await refresh(token)).toBe(401);
  });

  it("troca de role revoga", async () => {
    const { target, login, refresh, put } = await setup();
    const token = await login();
    await put(target.id, { roleId: "role_b" });
    expect(await refresh(token)).toBe(401);
  });

  it("update sem troca de role/status não revoga", async () => {
    const { target, login, refresh, put } = await setup();
    const token = await login();
    await put(target.id, { fullname: "Outro Nome" });
    expect(await refresh(token)).toBe(200);
  });

  it("exclusão revoga", async () => {
    const { admin, target, login, refresh } = await setup();
    const token = await login();
    await admin.request(`/api/iam/users/${target.id}`, { method: "DELETE" });
    expect(await refresh(token)).toBe(401);
  });
});

describe("último administrador ativo é protegido no store", () => {
  it("rebaixar, inativar ou excluir o último admin ativo lança", async () => {
    const store = createSeededUserStore({ admin: true });
    const root = (await store.findByUsername("test.root"))!;
    await expect(store.updateUser(root.id, { isAdmin: false })).rejects.toThrow(/administrador ativo/);
    await expect(store.updateUser(root.id, { status: "inactive" })).rejects.toThrow(/administrador ativo/);
    await expect(store.deleteUser(root.id)).rejects.toThrow(/administrador ativo/);
  });
});
