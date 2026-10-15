import { describe, it, expect, beforeAll } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { MockSourceConnector } from "../src/data/source-connector.js";
import { MemoryPersistenceStore } from "../src/data/persistence-store.js";
import fechamentoRecipe from "./fixtures/fechamento-mes.recipe.js";
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
});
