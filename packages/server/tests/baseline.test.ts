import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlatformApp } from "../src/index.js";
import { MockSourceConnector } from "../src/data/source-connector.js";
import { MemoryPersistenceStore } from "../src/data/persistence-store.js";
import { MemoryUserStore } from "../src/iam/user-store.js";
import type { SourceConnector } from "../src/data/source-connector.js";
import fechamentoRecipe from "./fixtures/fechamento-mes.recipe.js";
import { createSeededUserStore, seededWorkspaces, TEST_PASSWORD } from "./helpers/fixtures.js";

// Baseline executável: congela status+body de todas as rotas HTTP antes da refatoração em módulos.
// Regenerar: UPDATE_BASELINE=1 pnpm --filter @platform/server test baseline
const FILE = join(dirname(fileURLToPath(import.meta.url)), "baseline", "responses.json");
const T0 = new Date("2026-03-10T12:00:00.000Z");

interface Recorded {
  status: number;
  body: unknown;
  cookie?: string;
}
const results: Record<string, Recorded> = {};

const normalize = (s: string): string =>
  s
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<token>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, "<ts>");

const okConnector: SourceConnector = { query: async () => [], healthCheck: async () => true, close: async () => {} };
const failingConnector: SourceConnector = { query: async () => [], healthCheck: async () => false };

let app: ReturnType<typeof createPlatformApp>;
let rootId = "";
let A = "";
let V = "";
let O = "";
let R = "";
const updating = process.env.UPDATE_BASELINE === "1";
const expected: Record<string, Recorded> = updating ? {} : JSON.parse(readFileSync(FILE, "utf8"));

async function fresh(): Promise<void> {
  const userStore: MemoryUserStore = createSeededUserStore();
  const root = await userStore.createUser({
    fullname: "Root Admin",
    username: "root.admin",
    password: TEST_PASSWORD,
    roleId: "role_vendedor",
    externals: {},
  });
  await userStore.setAdmin(root.id, true);
  rootId = root.id;
  app = createPlatformApp({
    userStore,
    workspaces: seededWorkspaces.map((w) => ({ ...w })),
    sourceConnector: new MockSourceConnector({
      default: [
        { vendedor_id: 1, vendedor: "Carlos Vendedor", venda_geral: 10000 },
        { vendedor_id: 2, vendedor: "Ana Gerente", venda_geral: 25000 },
        { vendedor_id: 42, vendedor: "João da Silva", venda_geral: 15000 },
      ],
      "FROM categories": [
        { value: 1, label: "Medicamentos" },
        { value: 2, label: "Perfumaria" },
      ],
    }),
    persistenceStore: new MemoryPersistenceStore(),
    connectorFactory: (record) => (record.config.host === "bad" ? failingConnector : okConnector),
    recipes: { fechamento_mes: fechamentoRecipe },
  });
}

interface Opts {
  token?: string;
  body?: unknown;
  cookie?: string;
}

async function rec(key: string, method: string, path: string, opts: Opts = {}): Promise<{ raw: unknown }> {
  expect(results[key], `chave duplicada ${key}`).toBeUndefined();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.Cookie = opts.cookie;
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const res = await app.request(path, { method, headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // corpo não-JSON: mantém o texto
  }
  const out: Recorded = { status: res.status, body: JSON.parse(normalize(JSON.stringify(parsed))) };
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) out.cookie = normalize(setCookie).replace(/Expires=[^;]+/i, "Expires=<date>");
  results[key] = out;
  if (!updating) expect(out, `chave do caso: ${key}`).toEqual(expected[key]);
  return { raw: parsed };
}

const tick = () => vi.setSystemTime(new Date(Date.now() + 1000));

const validSource = (id: string) => `
import { defineRecipe } from "@platform/shared";
export default defineRecipe({
  id: "${id}", name: "Modelo Baseline", workspace: { params: [] }, sources: {},
  actions: [{ id: "acao_a", label: "A", permission: "recipe:${id}:action:acao_a", action: async () => {} }],
  ui: { layout: { type: "grid", columns: 12, gap: 16 }, components: [] },
});
`;

const WS = "ws_fechamento_jan_2026";
const WS_CLOSED = "ws_fechamento_dez_2025";
const comp = `/api/workspaces/${WS}/data/tabela_vendedores`;

describe("baseline HTTP (congelado antes da refatoração em módulos)", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    process.env.CONNECTIONS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    await fresh();
    const login = async (username: string): Promise<string> => {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: TEST_PASSWORD }),
      });
      return ((await res.json()) as { access_token: string }).access_token;
    };
    A = await login("carlos.admin"); // role_admin com todas as permissões system:*
    V = await login("joao.silva"); // vendedor: sem nenhuma permissão system:*
    O = await login("maria.souza"); // operador
    R = await login("root.admin"); // isAdmin com role sem permissões
  });
  afterAll(() => {
    if (updating) writeFileSync(FILE, JSON.stringify(results, null, 2) + "\n");
    vi.useRealTimers();
  });

  describe("auth", () => {
    it("rotas", async () => {
    // ── saúde
    await rec("health.get", "GET", "/api/health");

    // ── auth
    const lg = await rec("auth.login.ok", "POST", "/api/auth/login", { body: { username: "carlos.admin", password: TEST_PASSWORD } });
    await rec("auth.login.bad_password", "POST", "/api/auth/login", { body: { username: "carlos.admin", password: "x" } });
    await rec("auth.login.unknown_user", "POST", "/api/auth/login", { body: { username: "ninguem", password: "x" } });
    await rec("auth.login.invalid_body", "POST", "/api/auth/login", { body: { username: "carlos.admin" } });
    await rec("auth.login.admin_bypass", "POST", "/api/auth/login", { body: { username: "root.admin", password: TEST_PASSWORD } });
    const refresh = (lg.raw as { refresh_token: string }).refresh_token;
    await rec("auth.refresh.body", "POST", "/api/auth/refresh", { body: { refresh_token: refresh } });
    await rec("auth.refresh.cookie", "POST", "/api/auth/refresh", { body: {}, cookie: `refresh_token=${refresh}` });
    await rec("auth.refresh.missing", "POST", "/api/auth/refresh", { body: {} });
    await rec("auth.refresh.invalid", "POST", "/api/auth/refresh", { body: { refresh_token: "lixo" } });
    await rec("auth.refresh.access_token_as_refresh", "POST", "/api/auth/refresh", { body: { refresh_token: A } });
    await rec("auth.logout", "POST", "/api/auth/logout");
    await rec("auth.me.ok", "GET", "/api/auth/me", { token: A });
    await rec("auth.me.admin_bypass", "GET", "/api/auth/me", { token: R });
    await rec("auth.me.401_no_token", "GET", "/api/auth/me");
    await rec("auth.me.401_bad_token", "GET", "/api/auth/me", { token: "lixo" });

    });
  });

  describe("iam-users", () => {
    it("rotas", async () => {
    // ── IAM leitura (sucesso / 401 / 403 / bypass)
    const reads: [string, string][] = [
      ["catalog", "/api/iam/permissions/catalog"],
      ["sources", "/api/iam/sources"],
      ["users", "/api/iam/users"],
      ["roles", "/api/iam/roles"],
    ];
    for (const [k, p] of reads) {
      await rec(`iam.${k}.ok`, "GET", p, { token: A });
      await rec(`iam.${k}.401`, "GET", p);
      await rec(`iam.${k}.403`, "GET", p, { token: V });
      await rec(`iam.${k}.admin_bypass`, "GET", p, { token: R });
    }

    // ── IAM users
    const newUser = { fullname: "Novo Usuario", username: "novo.user", password: "Senha@456", roleId: "role_vendedor", externals: { inovafarma: 7 } };
    await rec("iam.users.create.401", "POST", "/api/iam/users", { body: newUser });
    await rec("iam.users.create.403", "POST", "/api/iam/users", { token: V, body: newUser });
    await rec("iam.users.create.400_weak_password", "POST", "/api/iam/users", { token: A, body: { ...newUser, password: "fraca" } });
    await rec("iam.users.create.400_short_username", "POST", "/api/iam/users", { token: A, body: { ...newUser, username: "ab" } });
    tick();
    const created = await rec("iam.users.create.ok", "POST", "/api/iam/users", { token: A, body: newUser });
    const newId = (created.raw as { id: string }).id;
    await rec("iam.users.create.400_duplicate", "POST", "/api/iam/users", { token: A, body: newUser });
    await rec("iam.users.create.unknown_role", "POST", "/api/iam/users", { token: A, body: { ...newUser, username: "outro.user", roleId: "inexistente" } });
    tick();
    await rec("iam.users.create.admin_bypass", "POST", "/api/iam/users", { token: R, body: { ...newUser, username: "novo.root", isAdmin: true } });

    await rec("iam.users.update.401", "PUT", `/api/iam/users/${newId}`, { body: { fullname: "X Y" } });
    await rec("iam.users.update.403", "PUT", `/api/iam/users/${newId}`, { token: V, body: { fullname: "X Y" } });
    await rec("iam.users.update.ok", "PUT", `/api/iam/users/${newId}`, { token: A, body: { fullname: "Nome Editado", status: "inactive", email: "a@b.com" } });
    await rec("iam.users.update.400_invalid_status", "PUT", `/api/iam/users/${newId}`, { token: A, body: { status: "foo" } });
    await rec("iam.users.update.400_unknown_user", "PUT", "/api/iam/users/nao_existe", { token: A, body: { fullname: "X Y" } });
    await rec("iam.users.update.403_isadmin_by_non_admin", "PUT", `/api/iam/users/${newId}`, { token: A, body: { isAdmin: true } });
    await rec("iam.users.update.ok_isadmin_by_admin", "PUT", `/api/iam/users/${newId}`, { token: R, body: { isAdmin: true } });
    await rec("iam.users.update.400_self_demote", "PUT", `/api/iam/users/${rootId}`, { token: R, body: { isAdmin: false } });

    await rec("iam.users.reset.401", "POST", `/api/iam/users/${newId}/reset-password`, { body: { newPassword: "Nova@1234" } });
    await rec("iam.users.reset.403", "POST", `/api/iam/users/${newId}/reset-password`, { token: V, body: { newPassword: "Nova@1234" } });
    await rec("iam.users.reset.400_weak", "POST", `/api/iam/users/${newId}/reset-password`, { token: A, body: { newPassword: "fraca" } });
    await rec("iam.users.reset.ok", "POST", `/api/iam/users/${newId}/reset-password`, { token: A, body: { newPassword: "Nova@1234" } });
    await rec("iam.users.reset.unknown_user", "POST", "/api/iam/users/nao_existe/reset-password", { token: A, body: { newPassword: "Nova@1234" } });
    await rec("iam.users.reset.admin_bypass", "POST", `/api/iam/users/${newId}/reset-password`, { token: R, body: { newPassword: "Outra@1234" } });

    await rec("iam.users.delete.401", "DELETE", `/api/iam/users/${newId}`);
    await rec("iam.users.delete.403", "DELETE", `/api/iam/users/${newId}`, { token: V });
    await rec("iam.users.delete.ok", "DELETE", `/api/iam/users/${newId}`, { token: A });
    await rec("iam.users.delete.again", "DELETE", `/api/iam/users/${newId}`, { token: A });
    await rec("iam.users.list.after", "GET", "/api/iam/users", { token: A });

    });
  });

  describe("iam-roles", () => {
    it("rotas", async () => {
    // ── IAM roles
    const role = { id: "role_teste", name: "Grupo Teste", description: "d", permissions: ["system:users:read", "recipe:fechamento_mes:view"] };
    await rec("iam.roles.create.401", "POST", "/api/iam/roles", { body: role });
    await rec("iam.roles.create.403", "POST", "/api/iam/roles", { token: V, body: role });
    await rec("iam.roles.create.400_invalid_keys", "POST", "/api/iam/roles", { token: A, body: { ...role, permissions: ["system:foo:bar", "recipe:nada:view"] } });
    await rec("iam.roles.create.400_short_id", "POST", "/api/iam/roles", { token: A, body: { ...role, id: "a" } });
    await rec("iam.roles.create.ok", "POST", "/api/iam/roles", { token: A, body: role });
    await rec("iam.roles.create.duplicate", "POST", "/api/iam/roles", { token: A, body: role });
    await rec("iam.roles.create.ok_wildcard", "POST", "/api/iam/roles", { token: R, body: { ...role, id: "role_curinga", permissions: ["*"] } });
    await rec("iam.roles.create.403_wildcard_non_admin", "POST", "/api/iam/roles", { token: A, body: { ...role, id: "role_curinga_a", permissions: ["*"] } });
    await rec("iam.roles.update.403_wildcard_non_admin", "PUT", "/api/iam/roles/role_curinga", { token: A, body: { permissions: ["system:roles:read"] } });
    await rec("iam.roles.update.401", "PUT", "/api/iam/roles/role_teste", { body: { name: "X Y" } });
    await rec("iam.roles.update.403", "PUT", "/api/iam/roles/role_teste", { token: V, body: { name: "X Y" } });
    await rec("iam.roles.update.ok", "PUT", "/api/iam/roles/role_teste", { token: A, body: { name: "Grupo Editado", permissions: ["system:roles:read"] } });
    await rec("iam.roles.update.400_invalid_keys", "PUT", "/api/iam/roles/role_teste", { token: A, body: { permissions: ["system:foo:bar"] } });
    await rec("iam.roles.update.unknown_role", "PUT", "/api/iam/roles/nao_existe", { token: A, body: { name: "X Y" } });
    await rec("iam.roles.update.admin_bypass", "PUT", "/api/iam/roles/role_teste", { token: R, body: { description: "via admin" } });
    await rec("iam.roles.list.after", "GET", "/api/iam/roles", { token: A });

    });
  });

  describe("workspaces", () => {
    it("rotas", async () => {
    // ── workspaces (auth opcional: sem token passa; 403 só com token sem permissão)
    await rec("ws.list.401", "GET", "/api/workspaces");
    await rec("ws.list.ok", "GET", "/api/workspaces", { token: O });
    await rec("ws.list.403", "GET", "/api/workspaces", { token: V });
    await rec("ws.list.filter", "GET", "/api/workspaces?recipe_id=outro", { token: O });
    await rec("ws.detail.ok", "GET", `/api/workspaces/${WS}`, { token: O });
    await rec("ws.detail.401", "GET", `/api/workspaces/${WS}`);
    await rec("ws.detail.403", "GET", `/api/workspaces/${WS}`, { token: V });
    await rec("ws.detail.unknown_404", "GET", "/api/workspaces/ws_inexistente", { token: O });
    const wsNew = { recipeId: "fechamento_mes", startDate: "2026-02-01", endDate: "2026-02-28", params: { categories_focus: [1] } };
    await rec("ws.create.403", "POST", "/api/workspaces", { token: V, body: wsNew });
    await rec("ws.create.400_dates", "POST", "/api/workspaces", { token: A, body: { ...wsNew, startDate: "2026-03-01", endDate: "2026-02-01" } });
    await rec("ws.create.400_missing_fields", "POST", "/api/workspaces", { token: A, body: { recipeId: "fechamento_mes" } });
    await rec("ws.create.400_unknown_recipe", "POST", "/api/workspaces", { token: A, body: { ...wsNew, recipeId: "nada" } });
    tick();
    const wsCreated = await rec("ws.create.ok", "POST", "/api/workspaces", { token: A, body: wsNew });
    const wsId = (wsCreated.raw as { id: string }).id;
    tick();
    await rec("ws.create.admin_bypass", "POST", "/api/workspaces", { token: R, body: { ...wsNew, name: "Via admin" } });
    tick();
    await rec("ws.create.401", "POST", "/api/workspaces", { body: wsNew });
    await rec("ws.update.403", "PUT", `/api/workspaces/${wsId}`, { token: V, body: { name: "Y Z" } });
    await rec("ws.update.ok", "PUT", `/api/workspaces/${wsId}`, { token: A, body: { name: "Renomeada", endDate: "2026-03-05" } });
    await rec("ws.update.400_dates", "PUT", `/api/workspaces/${wsId}`, { token: A, body: { endDate: "2026-01-01" } });
    await rec("ws.update.404", "PUT", "/api/workspaces/nao_existe", { token: A, body: { name: "Y Z" } });
    await rec("ws.conclude.403", "POST", `/api/workspaces/${wsId}/conclude`, { token: V });
    await rec("ws.conclude.ok", "POST", `/api/workspaces/${wsId}/conclude`, { token: O });
    await rec("ws.conclude.unknown_404", "POST", "/api/workspaces/ws_fantasma/conclude", { token: A });
    await rec("ws.reopen.403", "POST", `/api/workspaces/${wsId}/reopen`, { token: V });
    await rec("ws.reopen.ok", "POST", `/api/workspaces/${wsId}/reopen`, { token: A });
    await rec("ws.reopen.unknown_404", "POST", "/api/workspaces/ws_fantasma2/reopen", { token: A });
    await rec("ws.delete.403", "DELETE", `/api/workspaces/${wsId}`, { token: V });
    await rec("ws.delete.ok", "DELETE", `/api/workspaces/${wsId}`, { token: A });
    await rec("ws.delete.404", "DELETE", `/api/workspaces/${wsId}`, { token: A });

    });
  });

  describe("dashboards-data", () => {
    it("rotas", async () => {
    // ── recipes / lookups / dashboards
    await rec("recipes.catalog.401", "GET", "/api/recipes");
    await rec("recipes.catalog.vendedor", "GET", "/api/recipes", { token: V });
    await rec("recipes.catalog.admin_bypass", "GET", "/api/recipes", { token: R });
    await rec("lookups.ok", "GET", "/api/lookups?recipe_id=fechamento_mes&field=categories_focus", { token: A });
    await rec("lookups.403", "GET", "/api/lookups?recipe_id=outro&field=x", { token: V });
    await rec("lookups.400_no_lookup", "GET", "/api/lookups?recipe_id=fechamento_mes&field=start_date", { token: A });
    await rec("lookups.404_unknown_recipe", "GET", "/api/lookups?recipe_id=nada&field=x", { token: R });
    await rec("lookups.401", "GET", "/api/lookups?recipe_id=fechamento_mes&field=categories_focus");
    await rec("lookups.400_missing_query", "GET", "/api/lookups", { token: A });
    await rec("dashboards.schema.401", "GET", "/api/dashboards/fechamento_mes/schema");
    await rec("dashboards.schema.vendedor", "GET", "/api/dashboards/fechamento_mes/schema", { token: V });
    await rec("dashboards.schema.operador", "GET", "/api/dashboards/fechamento_mes/schema", { token: O });
    await rec("dashboards.schema.admin_bypass", "GET", "/api/dashboards/fechamento_mes/schema", { token: R });
    await rec("dashboards.schema.unknown_recipe", "GET", "/api/dashboards/nada/schema", { token: A });

    // ── dados dos componentes
    const q = "?recipe_id=fechamento_mes&start_date=2026-01-01&end_date=2026-01-31";
    await rec("data.table.operador", "GET", `${comp}${q}`, { token: O });
    await rec("data.table.vendedor", "GET", `${comp}${q}`, { token: V });
    await rec("data.table.admin", "GET", `${comp}${q}&profile_id=equipe&sort_by=vendedor&order=desc&page_size=2`, { token: A });
    await rec("data.table.admin_bypass", "GET", `${comp}${q}`, { token: R });
    await rec("data.table.search", "GET", `${comp}${q}&search=a`, { token: O });
    await rec("data.table.401", "GET", `${comp}${q}`);
    await rec("data.table.profile_without_permission", "GET", `${comp}${q}&profile_id=proprias`, { token: O });
    await rec("data.kpi.operador", "GET", `/api/workspaces/${WS}/data/kpi_total_vendas${q}`, { token: O });
    await rec("data.chart.operador", "GET", `/api/workspaces/${WS}/data/grafico_ranking_vendas${q}`, { token: O });
    await rec("data.400_dates", "GET", `${comp}?recipe_id=fechamento_mes&start_date=2026-02-01&end_date=2026-01-01`, { token: O });
    await rec("data.400_params_not_object", "GET", `${comp}${q}&params=%5B1%5D`, { token: O });
    await rec("data.ok_params", "GET", `${comp}${q}&params=${encodeURIComponent('{"categories_focus":[1,2],"x":1}')}`, { token: O });
    await rec("data.unknown_component", "GET", `/api/workspaces/${WS}/data/nao_existe${q}`, { token: O });

    // ── ações
    const row = { vendedor_id: 42, vendedor: "João da Silva" };
    const exec = (k: string, token: string | undefined, body: Record<string, unknown>, ws = WS) =>
      rec(k, "POST", `/api/workspaces/${ws}/actions/exec`, { token, body: { recipe_id: "fechamento_mes", component_id: "tabela_vendedores", row, ...body } });
    await exec("actions.dialog.operador", O, { action_id: "adicionar_penalidade" });
    await exec("actions.submit.operador", O, { action_id: "adicionar_penalidade", form_data: { valor: 10, reason: "atraso" } });
    await exec("actions.submit.admin_bypass", R, { action_id: "adicionar_penalidade", form_data: { valor: 5, reason: "bypass" } });
    await exec("actions.read.vendedor", V, { action_id: "visualizar_penalidades" });
    await exec("actions.vendedor_mutation", V, { action_id: "adicionar_penalidade", form_data: { valor: 1, reason: "x" } });
    await exec("actions.401", undefined, { action_id: "visualizar_penalidades" });
    await exec("actions.400_closed_workspace", O, { action_id: "adicionar_penalidade", form_data: { valor: 1, reason: "x" } }, WS_CLOSED);
    await exec("actions.400_unknown_component", O, { action_id: "adicionar_penalidade", component_id: "kpi_total_vendas" });
    await exec("actions.unknown_action", O, { action_id: "nao_existe" });
    await rec("actions.400_invalid_body", "POST", `/api/workspaces/${WS}/actions/exec`, { token: O, body: { action_id: "x" } });

    });
  });

  describe("persistence", () => {
    it("rotas", async () => {
    // ── persistência (auth + permissões)
    const pset = (k: string, ws: string, body: unknown, token: string | null = A) => rec(k, "POST", `/api/workspaces/${ws}/persistence/set`, { token: token ?? undefined, body });
    await pset("persistence.set.ok", WS, { target: "remuneracao_vendedor", target_foreign_key_value: 42, field: "salario_base", value: 2000, workspace_version: 3 });
    await pset("persistence.set.400_closed", WS_CLOSED, { target: "remuneracao_vendedor", target_foreign_key_value: 42, field: "salario_base", value: 1 });
    await pset("persistence.set.400_invalid_body", WS, { target: "x" });
    const sv = { target: "remuneracao_vendedor", target_foreign_key_value: 42, field: "salario_base", value: 1 };
    await pset("persistence.set.401", WS, sv, null);
    await pset("persistence.set.403", WS, sv, O);
    await pset("persistence.set.404_unknown_workspace", "ws_inexistente", sv);
    const col = `/api/workspaces/${WS}/persistence/collection/penalidades_vendedor`;
    await rec("persistence.collection.ok", "GET", `${col}/42`, { token: O });
    await rec("persistence.collection.empty", "GET", `${col}/9999`, { token: O });
    await rec("persistence.collection.404_unknown_workspace", "GET", "/api/workspaces/ws_inexistente/persistence/collection/penalidades_vendedor/42", { token: O });
    await rec("persistence.collection.401", "GET", `${col}/42`);
    await rec("persistence.collection.403", "GET", `${col}/42`, { token: V });

    });
  });

  describe("admin-recipes", () => {
    it("rotas", async () => {
    await fresh();
    // ── admin recipes (app novo para o estado ser previsível)
    await fresh();
    await rec("admin.recipes.list.initial", "GET", "/api/admin/recipes", { token: A });
    await rec("admin.recipes.list.401", "GET", "/api/admin/recipes");
    await rec("admin.recipes.list.403", "GET", "/api/admin/recipes", { token: V });
    await rec("admin.recipes.put.401", "PUT", "/api/admin/recipes/novo", { body: { source: validSource("novo") } });
    await rec("admin.recipes.put.403", "PUT", "/api/admin/recipes/novo", { token: V, body: { source: validSource("novo") } });
    await rec("admin.recipes.put.400_compile", "PUT", "/api/admin/recipes/quebrado", { token: A, body: { source: "export default defineRecipe({" } });
    await rec("admin.recipes.put.400_empty", "PUT", "/api/admin/recipes/vazio", { token: A, body: { source: "" } });
    await rec("admin.recipes.put.ok", "PUT", "/api/admin/recipes/novo", { token: A, body: { source: validSource("novo") } });
    await rec("admin.recipes.put.admin_bypass", "PUT", "/api/admin/recipes/outro", { token: R, body: { source: validSource("outro") } });
    await rec("admin.recipes.get.ok", "GET", "/api/admin/recipes/novo", { token: A });
    await rec("admin.recipes.get.404", "GET", "/api/admin/recipes/nada", { token: A });
    await rec("admin.recipes.get.403", "GET", "/api/admin/recipes/novo", { token: V });
    await rec("admin.recipes.list.after", "GET", "/api/admin/recipes", { token: A });
    await rec("admin.recipes.catalog_includes_new", "GET", "/api/iam/permissions/catalog", { token: A });
    await rec("admin.recipes.reload.401", "POST", "/api/admin/recipes/reload");
    await rec("admin.recipes.reload.403", "POST", "/api/admin/recipes/reload", { token: V });
    await rec("admin.recipes.reload.ok", "POST", "/api/admin/recipes/reload", { token: A });
    await rec("admin.recipes.delete.401", "DELETE", "/api/admin/recipes/novo");
    await rec("admin.recipes.delete.403", "DELETE", "/api/admin/recipes/novo", { token: V });
    await rec("admin.recipes.delete.ok", "DELETE", "/api/admin/recipes/novo", { token: A });
    await rec("admin.recipes.delete.404", "DELETE", "/api/admin/recipes/novo", { token: A });

    });
  });

  describe("admin-connections", () => {
    it("rotas", async () => {
    // ── admin connections / erp-types
    await rec("admin.erp_types.ok", "GET", "/api/admin/erp-types", { token: A });
    await rec("admin.erp_types.401", "GET", "/api/admin/erp-types");
    await rec("admin.erp_types.403", "GET", "/api/admin/erp-types", { token: V });
    await rec("admin.erp_types.admin_bypass", "GET", "/api/admin/erp-types", { token: R });
    const values = { host: "db", port: 1433, database: "erp", username: "ro", password: "Seg@1234" };
    const conn = { name: "InovaFarma", type: "mssql", values };
    await rec("admin.connections.list.empty", "GET", "/api/admin/connections", { token: A });
    await rec("admin.connections.list.401", "GET", "/api/admin/connections");
    await rec("admin.connections.list.403", "GET", "/api/admin/connections", { token: V });
    await rec("admin.connections.put.401", "PUT", "/api/admin/connections/inovafarma", { body: conn });
    await rec("admin.connections.put.403", "PUT", "/api/admin/connections/inovafarma", { token: V, body: conn });
    await rec("admin.connections.put.400_id", "PUT", "/api/admin/connections/Inova-Farma", { token: A, body: conn });
    await rec("admin.connections.put.400_type", "PUT", "/api/admin/connections/inovafarma", { token: A, body: { ...conn, type: "oracle" } });
    await rec("admin.connections.put.400_missing_secret", "PUT", "/api/admin/connections/inovafarma", { token: A, body: { ...conn, values: { ...values, password: "" } } });
    await rec("admin.connections.put.400_port", "PUT", "/api/admin/connections/inovafarma", { token: A, body: { ...conn, values: { ...values, port: 99999 } } });
    await rec("admin.connections.put.400_invalid_body", "PUT", "/api/admin/connections/inovafarma", { token: A, body: { name: "" } });
    await rec("admin.connections.put.ok", "PUT", "/api/admin/connections/inovafarma", { token: A, body: conn });
    await rec("admin.connections.put.ok_keep_secret", "PUT", "/api/admin/connections/inovafarma", { token: A, body: { ...conn, values: { ...values, host: "novo", password: "" } } });
    await rec("admin.connections.put.admin_bypass", "PUT", "/api/admin/connections/ruim", { token: R, body: { ...conn, values: { ...values, host: "bad" } } });
    await rec("admin.connections.list.after", "GET", "/api/admin/connections", { token: A });
    await rec("iam.sources.after", "GET", "/api/iam/sources", { token: A });
    await rec("admin.connections.test.ok", "POST", "/api/admin/connections/inovafarma/test", { token: A });
    await rec("admin.connections.test.502", "POST", "/api/admin/connections/ruim/test", { token: A });
    await rec("admin.connections.test.404", "POST", "/api/admin/connections/nada/test", { token: A });
    await rec("admin.connections.test.401", "POST", "/api/admin/connections/inovafarma/test");
    await rec("admin.connections.test.403", "POST", "/api/admin/connections/inovafarma/test", { token: V });
    await rec("admin.connections.delete.401", "DELETE", "/api/admin/connections/inovafarma");
    await rec("admin.connections.delete.403", "DELETE", "/api/admin/connections/inovafarma", { token: V });
    await rec("admin.connections.delete.ok", "DELETE", "/api/admin/connections/inovafarma", { token: A });
    await rec("admin.connections.delete.404", "DELETE", "/api/admin/connections/inovafarma", { token: A });

    });
  });

  it("cobre exatamente as chaves da fixture", () => {
    if (!updating) expect(Object.keys(results).sort()).toEqual(Object.keys(expected).sort());
  });
});
