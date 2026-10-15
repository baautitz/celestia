import { describe, it, expect, beforeAll } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { MockSourceConnector } from "../src/data/source-connector.js";
import { MemoryPersistenceStore } from "../src/data/persistence-store.js";
import fechamentoRecipe from "./fixtures/fechamento-mes.recipe.js";
import { canGrant, missingGrants } from "../src/iam/can-grant.js";
import { hasPermission } from "../src/iam/has-permission.js";
import { PermissionResolver } from "../src/iam/permission-resolver.js";
import { authHeader, createSeededUserStore, seededWorkspaces, TEST_PASSWORD } from "./helpers/fixtures.js";

const WS = "ws_fechamento_jan_2026";
const q = "?recipe_id=fechamento_mes&start_date=2026-01-01&end_date=2026-01-31";

describe("hardening de auth: permissão ausente falha fechado", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let semView: Record<string, string>;
  let curinga: Record<string, string>;

  beforeAll(async () => {
    const userStore = createSeededUserStore();
    await userStore.createRole({ id: "role_sem_view", name: "Sem Modelo", description: "d", permissions: ["system:workspaces:read"] });
    await userStore.createUser({ fullname: "Teste Usuario", username: "sem.view", password: TEST_PASSWORD, roleId: "role_sem_view", externals: {} });
    app = createPlatformApp({
      userStore,
      workspaces: seededWorkspaces.map((w) => ({ ...w })),
      sourceConnector: new MockSourceConnector({ default: [{ vendedor_id: 1, vendedor: "A", venda_geral: 1 }] }),
      persistenceStore: new MemoryPersistenceStore(),
      recipes: { fechamento_mes: fechamentoRecipe },
    });
    // Criado após o boot: o sync de órfãs remove "*" de roles existentes na inicialização.
    await userStore.createRole({ id: "role_curinga", name: "Curinga", description: "d", permissions: ["*"] });
    await userStore.createUser({ fullname: "Teste Usuario", username: "cur.inga", password: TEST_PASSWORD, roleId: "role_curinga", externals: {} });
    semView = await authHeader(app, "sem.view");
    curinga = await authHeader(app, "cur.inga");
  });

  const post = (headers: Record<string, string>) =>
    app.request(`/api/workspaces/${WS}/actions/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        recipe_id: "fechamento_mes",
        component_id: "tabela_vendedores",
        action_id: "visualizar_penalidades",
        row: { vendedor_id: 1 },
      }),
    });

  it("sem recipe:<id>:view: schema, data e exec respondem 403", async () => {
    expect((await app.request("/api/dashboards/fechamento_mes/schema", { headers: semView })).status).toBe(403);
    expect((await app.request(`/api/workspaces/${WS}/data/tabela_vendedores${q}`, { headers: semView })).status).toBe(403);
    expect((await post(semView)).status).toBe(403);
  });

  it("sem token: 401 em schema, data, exec e persistência", async () => {
    expect((await app.request("/api/dashboards/fechamento_mes/schema")).status).toBe(401);
    expect((await app.request(`/api/workspaces/${WS}/data/tabela_vendedores${q}`)).status).toBe(401);
    expect((await post({})).status).toBe(401);
    expect((await app.request(`/api/workspaces/${WS}/persistence/collection/c/1`)).status).toBe(401);
  });

  it("curinga '*' passa pela checagem de visualização do Modelo", async () => {
    expect((await app.request("/api/dashboards/fechamento_mes/schema", { headers: curinga })).status).toBe(200);
  });

  it("curinga '*' não-admin acessa rotas system:* e workspaces", async () => {
    expect((await app.request("/api/iam/users", { headers: curinga })).status).toBe(200);
    expect((await app.request("/api/workspaces", { headers: curinga })).status).toBe(200);
    expect((await app.request(`/api/workspaces/${WS}/persistence/collection/c/1`, { headers: curinga })).status).toBe(200);
  });

  it("role com '*' mantém o curinga após o sync de órfãs", async () => {
    const store = createSeededUserStore();
    await store.createRole({ id: "role_c", name: "Curinga", description: "d", permissions: ["*", "recipe:morto:view"] });
    await store.syncOrphanPermissions({ fechamento_mes: fechamentoRecipe });
    expect((await store.getRole("role_c"))?.permissions).toEqual(["*"]);
  });

  it("PermissionResolver e hasPermission falham fechado sem permissões", () => {
    expect(hasPermission(undefined, "x")).toBe(false);
    expect(hasPermission([], "x")).toBe(false);
    expect(hasPermission(["*"], "x")).toBe(true);
    expect(PermissionResolver.canViewRecipe("fechamento_mes", [])).toBe(false);
    expect(PermissionResolver.canUsePermission("x", undefined)).toBe(false);
  });

  describe("curinga '*' em roles é ato de administrador", () => {
    let gestor: Record<string, string>;
    let admin: Record<string, string>;
    const send = (method: string, path: string, headers: Record<string, string>, body: object) =>
      app.request(path, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

    beforeAll(async () => {
      const store = createSeededUserStore({ admin: true });
      await store.createRole({ id: "role_gestor", name: "Gestor", description: "d", permissions: ["system:roles:create", "system:roles:update", "system:roles:read"] });
      await store.createUser({ fullname: "Gestor Roles", username: "gestor.roles", password: TEST_PASSWORD, roleId: "role_gestor", externals: {} });
      app = createPlatformApp({ userStore: store, recipes: { fechamento_mes: fechamentoRecipe } });
      gestor = await authHeader(app, "gestor.roles");
      admin = await authHeader(app, "test.root");
      await store.createRole({ id: "role_total", name: "Total", description: "d", permissions: ["*"] });
    });

    it("não-admin criando role com '*' recebe 403; admin recebe 201", async () => {
      const body = { id: "role_x", name: "Role X", permissions: ["*"] };
      const denied = await send("POST", "/api/iam/roles", gestor, body);
      expect(denied.status).toBe(403);
      expect(((await denied.json()) as { error: string }).error).toContain("Somente administradores");
      expect((await send("POST", "/api/iam/roles", admin, body)).status).toBe(201);
    });

    it("não-admin edita role comum sem '*': ok; tentar conceder '*': 403", async () => {
      await send("POST", "/api/iam/roles", gestor, { id: "role_y", name: "Role Y", permissions: [] });
      expect((await send("PUT", "/api/iam/roles/role_y", gestor, { permissions: ["system:roles:read"] })).status).toBe(200);
      expect((await send("PUT", "/api/iam/roles/role_y", gestor, { permissions: ["*"] })).status).toBe(403);
    });

    it("não-admin não mantém nem remove '*' de role que o tem; renomear continua permitido", async () => {
      expect((await send("PUT", "/api/iam/roles/role_total", gestor, { permissions: ["system:users:read"] })).status).toBe(403);
      expect((await send("PUT", "/api/iam/roles/role_total", gestor, { name: "Total 2" })).status).toBe(200);
      expect((await send("PUT", "/api/iam/roles/role_total", admin, { permissions: ["*", "system:users:read"] })).status).toBe(200);
    });
  });

  describe("só concede o que possui", () => {
    let gestor: Record<string, string>;
    let admin: Record<string, string>;
    let coringa: Record<string, string>;
    let alvoComumId = "";
    let alvoAdminId = "";
    const send = (method: string, path: string, headers: Record<string, string>, body: object) =>
      app.request(path, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    const newUser = (username: string, roleId: string) => ({ fullname: "Novo Usuario", username, password: "Senha@456", roleId, externals: {} });

    beforeAll(async () => {
      const store = createSeededUserStore({ admin: true });
      await store.createRole({
        id: "role_gestor",
        name: "Gestor",
        description: "d",
        permissions: ["system:users:create", "system:users:update", "system:users:reset_password", "system:roles:create", "system:roles:update", "system:roles:read", "system:users:read"],
      });
      await store.createRole({ id: "role_pequeno", name: "Pequeno", description: "d", permissions: ["system:users:read"] });
      await store.createUser({ fullname: "Gestor Grants", username: "gestor.grants", password: TEST_PASSWORD, roleId: "role_gestor", externals: {} });
      const comum = await store.createUser({ fullname: "Alvo Comum", username: "alvo.comum", password: TEST_PASSWORD, roleId: "role_pequeno", externals: {} });
      const alvoAdmin = await store.createUser({ fullname: "Alvo Admin", username: "alvo.admin", password: TEST_PASSWORD, roleId: "role_pequeno", externals: {} });
      await store.setAdmin(alvoAdmin.id, true);
      alvoComumId = comum.id;
      alvoAdminId = alvoAdmin.id;
      app = createPlatformApp({ userStore: store, recipes: { fechamento_mes: fechamentoRecipe } });
      gestor = await authHeader(app, "gestor.grants");
      admin = await authHeader(app, "test.root");
      await store.createRole({ id: "role_total", name: "Total", description: "d", permissions: ["*"] });
      await store.createUser({ fullname: "Coringa Geral", username: "coringa.geral", password: TEST_PASSWORD, roleId: "role_total", externals: {} });
      coringa = await authHeader(app, "coringa.geral");
    });

    it("PUT user: gestor não atribui role mais poderoso (nem a si mesmo); atribui subconjunto; admin atribui qualquer", async () => {
      const denied = await send("PUT", `/api/iam/users/${alvoComumId}`, gestor, { roleId: "role_admin" });
      expect(denied.status).toBe(403);
      expect(((await denied.json()) as { error: string }).error).toContain("Você não pode conceder permissões que não possui");
      expect((await send("PUT", `/api/iam/users/${alvoComumId}`, gestor, { roleId: "role_pequeno" })).status).toBe(200);
      expect((await send("PUT", `/api/iam/users/${alvoComumId}`, gestor, { fullname: "Nome Novo" })).status).toBe(200);
      expect((await send("PUT", `/api/iam/users/${alvoComumId}`, admin, { roleId: "role_admin" })).status).toBe(200);
    });

    it("POST user: gestor não cria usuário com role mais poderoso; cria com subconjunto", async () => {
      expect((await send("POST", "/api/iam/users", gestor, newUser("cumplice.um", "role_admin"))).status).toBe(403);
      expect((await send("POST", "/api/iam/users", gestor, newUser("legitimo.um", "role_pequeno"))).status).toBe(201);
    });

    it("POST role: só com chaves que possui; PUT role: só adicionar o que possui, remover é livre", async () => {
      expect((await send("POST", "/api/iam/roles", gestor, { id: "role_g1", name: "G Um", permissions: ["system:users:delete"] })).status).toBe(403);
      expect((await send("POST", "/api/iam/roles", gestor, { id: "role_g2", name: "G Dois", permissions: ["system:users:read"] })).status).toBe(201);
      expect((await send("PUT", "/api/iam/roles/role_gestor", gestor, { permissions: ["system:users:create", "system:users:update", "system:users:reset_password", "system:roles:create", "system:roles:update", "system:roles:read", "system:users:read", "system:users:delete"] })).status).toBe(403);
      expect((await send("PUT", "/api/iam/roles/role_g2", gestor, { permissions: [] })).status).toBe(200);
      expect((await send("PUT", "/api/iam/roles/role_g2", gestor, { name: "Renomeado" })).status).toBe(200);
    });

    it("mensagem lista no máximo 10 chaves", async () => {
      const todas = (await (await app.request("/api/iam/permissions/catalog", { headers: admin })).json()) as { system: Record<string, { key: string }[]> };
      const keys = Object.values(todas.system).flat().map((p) => p.key);
      const res = await send("POST", "/api/iam/roles", gestor, { id: "role_g3", name: "G Tres", permissions: keys.filter((k) => !k.startsWith("system:users:read")) });
      const msg = ((await res.json()) as { error: string }).error;
      expect(res.status).toBe(403);
      expect(msg.split(", ").length).toBeLessThanOrEqual(10);
      expect(msg).toContain("e mais");
    });

    it("reset-password: usuário comum ok; admin alvo só por admin", async () => {
      const body = { newPassword: "Nova@12345" };
      expect((await send("POST", `/api/iam/users/${alvoComumId}/reset-password`, gestor, body)).status).toBe(200);
      const denied = await send("POST", `/api/iam/users/${alvoAdminId}/reset-password`, gestor, body);
      expect(denied.status).toBe(403);
      expect(((await denied.json()) as { error: string }).error).toBe("Somente administradores podem redefinir a senha de outro administrador.");
      expect((await send("POST", `/api/iam/users/${alvoAdminId}/reset-password`, admin, body)).status).toBe(200);
    });

    it("'*' do chamador cobre tudo (exceto conceder '*', que é só admin); fail-closed sem permissões", async () => {
      expect((await send("PUT", `/api/iam/users/${alvoComumId}`, coringa, { roleId: "role_gestor" })).status).toBe(200);
      expect(missingGrants(undefined, ["a"], false)).toEqual(["a"]);
      expect(missingGrants([], ["a"], false)).toEqual(["a"]);
      expect(canGrant(["*"], ["a", "b"], false)).toBe(true);
      expect(canGrant(["a"], ["a", "b"], false)).toBe(false);
      expect(canGrant(undefined, ["a"], true)).toBe(true);
    });
  });
});
