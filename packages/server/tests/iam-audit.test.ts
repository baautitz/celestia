import { describe, expect, it } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { AuditLog } from "../src/audit/audit-log.js";
import { MemoryAuditStore } from "../src/audit/audit-store.js";
import type { MemoryUserStore } from "../src/iam/user-store.js";
import { createSeededUserStore, TEST_PASSWORD, withAuth } from "./helpers/fixtures.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const NEW_PASSWORD = "Nova@12345";

async function setup() {
  const userStore = createSeededUserStore({ admin: true });
  await userStore.createRole({ id: "role_a", name: "Grupo A", description: "d", permissions: ["system:users:read"] });
  const auditLog = new AuditLog(new MemoryAuditStore());
  const app = createPlatformApp({ userStore, auditLog });
  const admin = withAuth(app, "test.root");
  const send = (method: string, path: string, body?: object) =>
    admin.request(path, { method, headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
  const entries = async (action: string) => (await auditLog.list({ plugin: "iam" })).filter((e) => e.action === action);
  return { userStore, auditLog, send, entries };
}

describe("Audit Log de Users e Roles", () => {
  it("registra criar, alterar, inativar, redefinir senha e excluir usuário, sem senha nem hash", async () => {
    const { send, entries, auditLog } = await setup();
    const created = (await (await send("POST", "/api/iam/users", { fullname: "Ana Souza", username: "ana", password: TEST_PASSWORD, roleId: "role_a" })).json()) as { id: string };
    expect(await entries("create_user")).toMatchObject([
      { actorName: "Test Root", targetType: "user", targetId: created.id, attributes: { username: "ana", fullname: "Ana Souza", roleId: "role_a" }, summary: 'Criou o usuário "ana" (Ana Souza) no grupo "role_a".' },
    ]);

    await send("PUT", `/api/iam/users/${created.id}`, { fullname: "Ana Souza Lima", email: "ana@exemplo.com" });
    expect(await entries("update_user")).toMatchObject([{ targetId: created.id, attributes: { username: "ana", fields: ["fullname", "email"] } }]);

    await send("PUT", `/api/iam/users/${created.id}`, { status: "inactive" });
    expect(await entries("deactivate_user")).toMatchObject([{ targetId: created.id, attributes: { username: "ana" } }]);

    await send("POST", `/api/iam/users/${created.id}/reset-password`, { newPassword: NEW_PASSWORD });
    expect(await entries("reset_password")).toMatchObject([{ targetId: created.id, attributes: { username: "ana" } }]);

    expect((await send("DELETE", `/api/iam/users/${created.id}`)).status).toBe(200);
    expect(await entries("delete_user")).toMatchObject([{ targetId: created.id, attributes: { username: "ana" } }]);

    const serialized = JSON.stringify(await auditLog.list({ plugin: "iam" }));
    expect(serialized).not.toContain(TEST_PASSWORD);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toMatch(/passwordHash|\$argon2/);
  });

  it("não registra o que falhou nem alteração que não mudou nada", async () => {
    const { send, entries } = await setup();
    const created = (await (await send("POST", "/api/iam/users", { fullname: "Ana Souza", username: "ana", password: TEST_PASSWORD, roleId: "role_a" })).json()) as { id: string };
    expect((await send("POST", "/api/iam/users", { fullname: "Outra Ana", username: "ANA", password: TEST_PASSWORD, roleId: "role_a" })).status).toBe(409);
    await send("PUT", `/api/iam/users/${created.id}`, { fullname: "Ana Souza" });
    expect(await entries("create_user")).toHaveLength(1);
    expect(await entries("update_user")).toHaveLength(0);
  });

  it("registra criar e alterar grupo de acesso com as permissões adicionadas e retiradas", async () => {
    const { send, entries } = await setup();
    await send("POST", "/api/iam/roles", { id: "role_b", name: "Grupo B", permissions: ["system:users:read"] });
    expect(await entries("create_role")).toMatchObject([
      { targetType: "role", targetId: "role_b", attributes: { name: "Grupo B", permissions: ["system:users:read"] } },
    ]);

    await send("PUT", "/api/iam/roles/role_b", { name: "Grupo B2", permissions: ["system:roles:read"] });
    expect(await entries("update_role")).toMatchObject([
      {
        targetType: "role", targetId: "role_b",
        attributes: { name: "Grupo B2", fields: ["name", "permissions"], addedPermissions: ["system:roles:read"], removedPermissions: ["system:users:read"] },
      },
    ]);
  });
});

describe("erros de domínio das stores", () => {
  it("usuário ou grupo inexistente responde 404; duplicado, 409", async () => {
    const { send } = await setup();
    expect((await send("PUT", "/api/iam/users/nao-existe", { fullname: "Fulano de Tal" })).status).toBe(404);
    expect((await send("POST", "/api/iam/users/nao-existe/reset-password", { newPassword: NEW_PASSWORD })).status).toBe(404);
    expect((await send("DELETE", "/api/iam/users/nao-existe")).status).toBe(404);
    expect((await send("PUT", "/api/iam/roles/nao-existe", { name: "Nome Novo" })).status).toBe(404);
    expect((await send("POST", "/api/iam/roles", { id: "role_a", name: "Duplicado", permissions: [] })).status).toBe(409);
  });

  it("erro inesperado da store não vaza a mensagem para o cliente", async () => {
    const userStore = createSeededUserStore({ admin: true });
    await userStore.createRole({ id: "role_a", name: "Grupo A", description: "d", permissions: [] });
    const secret = 'connection to server at "10.0.0.7" failed: password authentication failed';
    const failing: MemoryUserStore = Object.assign(Object.create(userStore) as MemoryUserStore, {
      createUser: () => Promise.reject(new Error(secret)),
    });
    const app = withAuth(createPlatformApp({ userStore: failing }), "test.root");
    const res = await app.request("/api/iam/users", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ fullname: "Ana Souza", username: "ana", password: TEST_PASSWORD, roleId: "role_a" }),
    });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("10.0.0.7");
  });

  it("e-mail pode ser limpo e nomes vazios ou curtos são recusados", async () => {
    const { send } = await setup();
    const created = (await (await send("POST", "/api/iam/users", { fullname: "Ana Souza", username: "ana", password: TEST_PASSWORD, roleId: "role_a", email: "ana@exemplo.com" })).json()) as { id: string };
    expect((await send("PUT", `/api/iam/users/${created.id}`, { fullname: "" })).status).toBe(400);
    expect((await send("PUT", "/api/iam/roles/role_a", { name: "" })).status).toBe(400);
    expect((await send("PUT", `/api/iam/users/${created.id}`, { email: "nao-e-email" })).status).toBe(400);
    const cleared = await send("PUT", `/api/iam/users/${created.id}`, { email: "" });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { email?: string }).email).toBeUndefined();
  });
});

describe("curinga * em grupos de acesso", () => {
  it("quem não é administrador não cria nem concede o grupo com o curinga", async () => {
    const userStore = createSeededUserStore({ admin: true });
    await userStore.createRole({ id: "editor", name: "Editor de grupos", description: "d", permissions: ["system:roles:create", "system:roles:update", "system:roles:read"] });
    await userStore.createRole({ id: "alvo", name: "Alvo", description: "d", permissions: [] });
    await userStore.createUser({ fullname: "Editora", username: "editora", password: TEST_PASSWORD, roleId: "editor" });
    const app = withAuth(createPlatformApp({ userStore }), "editora");
    const send = (method: string, path: string, body: object) => app.request(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
    expect((await send("POST", "/api/iam/roles", { id: "super", name: "Super", permissions: ["*"] })).status).toBe(403);
    expect((await send("PUT", "/api/iam/roles/alvo", { permissions: ["*"] })).status).toBe(403);
    expect((await userStore.getRole("super"))).toBeNull();
    expect((await userStore.getRole("alvo"))?.permissions).toEqual([]);
  });
});
