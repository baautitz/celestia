import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlatformApp } from "../src/index.js";
import { MemoryUserStore } from "../src/iam/user-store.js";
import type { ErpClient } from "../src/erp/erp-client.js";
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

const okClient: ErpClient = { query: async () => [], healthCheck: async () => true, close: async () => {} };
const failingClient: ErpClient = { query: async () => [], healthCheck: async () => false };

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
    clientFactory: (record) => (record.config.host === "bad" ? failingClient : okClient),
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

const WS = "ws_fechamento_jan_2026";
describe("baseline HTTP (congelado antes da refatoração em módulos)", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    process.env.ERP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
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
      ["erps", "/api/iam/erps"],
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
    await rec("iam.users.reset.403_target_admin", "POST", `/api/iam/users/${newId}/reset-password`, { token: A, body: { newPassword: "Nova@1234" } });
    await rec("iam.users.reset.ok_common_user", "POST", "/api/iam/users/usr_1002/reset-password", { token: A, body: { newPassword: "Nova@1234" } });
    await rec("iam.users.reset.unknown_user", "POST", "/api/iam/users/nao_existe/reset-password", { token: A, body: { newPassword: "Nova@1234" } });
    await rec("iam.users.reset.admin_bypass", "POST", `/api/iam/users/${newId}/reset-password`, { token: R, body: { newPassword: "Outra@1234" } });

    await rec("iam.users.delete.401", "DELETE", `/api/iam/users/${newId}`);
    await rec("iam.users.delete.403", "DELETE", `/api/iam/users/${newId}`, { token: V });
    await rec("iam.users.delete.403_target_admin", "DELETE", `/api/iam/users/${newId}`, { token: A });
    await rec("iam.users.delete.ok", "DELETE", `/api/iam/users/${newId}`, { token: R });
    await rec("iam.users.delete.again", "DELETE", `/api/iam/users/${newId}`, { token: A });
    await rec("iam.users.list.after", "GET", "/api/iam/users", { token: A });

    });
  });

  describe("iam-roles", () => {
    it("rotas", async () => {
    // ── IAM roles
    const role = { id: "role_teste", name: "Grupo Teste", description: "d", permissions: ["system:users:read", "system:workspaces:read"] };
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
    await rec("ws.detail.ok", "GET", `/api/workspaces/${WS}`, { token: O });
    await rec("ws.detail.401", "GET", `/api/workspaces/${WS}`);
    await rec("ws.detail.403", "GET", `/api/workspaces/${WS}`, { token: V });
    await rec("ws.detail.unknown_404", "GET", "/api/workspaces/ws_inexistente", { token: O });
    const wsNew = { name: "Fevereiro", startDate: "2026-02-01", endDate: "2026-02-28" };
    await rec("ws.create.403", "POST", "/api/workspaces", { token: V, body: wsNew });
    await rec("ws.create.400_dates", "POST", "/api/workspaces", { token: A, body: { ...wsNew, startDate: "2026-03-01", endDate: "2026-02-01" } });
    await rec("ws.create.400_missing_fields", "POST", "/api/workspaces", { token: A, body: { name: "Sem datas" } });
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
    await rec("ws.update.400_invalid_date", "PUT", `/api/workspaces/${wsId}`, { token: A, body: { startDate: "abc" } });
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

  describe("admin-erps", () => {
    it("rotas", async () => {
    await fresh();
    // ── ERPs e ERP Drivers
    await rec("admin.erp_drivers.ok", "GET", "/api/admin/erp-drivers", { token: A });
    await rec("admin.erp_drivers.401", "GET", "/api/admin/erp-drivers");
    await rec("admin.erp_drivers.403", "GET", "/api/admin/erp-drivers", { token: V });
    await rec("admin.erp_drivers.admin_bypass", "GET", "/api/admin/erp-drivers", { token: R });
    const values = { host: "db", port: 1433, database: "erp", username: "ro", password: "Seg@1234" };
    const erpBody = { name: "InovaFarma", driver: "mssql", values };
    await rec("admin.erps.list.empty", "GET", "/api/admin/erps", { token: A });
    await rec("admin.erps.list.401", "GET", "/api/admin/erps");
    await rec("admin.erps.list.403", "GET", "/api/admin/erps", { token: V });
    await rec("admin.erps.put.401", "PUT", "/api/admin/erps/inovafarma", { body: erpBody });
    await rec("admin.erps.put.403", "PUT", "/api/admin/erps/inovafarma", { token: V, body: erpBody });
    await rec("admin.erps.put.400_id", "PUT", "/api/admin/erps/Inova-Farma", { token: A, body: erpBody });
    await rec("admin.erps.put.400_driver", "PUT", "/api/admin/erps/inovafarma", { token: A, body: { ...erpBody, driver: "oracle" } });
    await rec("admin.erps.put.400_missing_secret", "PUT", "/api/admin/erps/inovafarma", { token: A, body: { ...erpBody, values: { ...values, password: "" } } });
    await rec("admin.erps.put.400_port", "PUT", "/api/admin/erps/inovafarma", { token: A, body: { ...erpBody, values: { ...values, port: 99999 } } });
    await rec("admin.erps.put.400_invalid_body", "PUT", "/api/admin/erps/inovafarma", { token: A, body: { name: "" } });
    await rec("admin.erps.put.ok", "PUT", "/api/admin/erps/inovafarma", { token: A, body: erpBody });
    await rec("admin.erps.put.ok_keep_secret", "PUT", "/api/admin/erps/inovafarma", { token: A, body: { ...erpBody, values: { ...values, host: "novo", password: "" } } });
    await rec("admin.erps.put.admin_bypass", "PUT", "/api/admin/erps/ruim", { token: R, body: { ...erpBody, values: { ...values, host: "bad" } } });
    await rec("admin.erps.list.after", "GET", "/api/admin/erps", { token: A });
    await rec("iam.erps.after", "GET", "/api/iam/erps", { token: A });
    await rec("admin.erps.test.ok", "POST", "/api/admin/erps/inovafarma/test", { token: A });
    await rec("admin.erps.test.502", "POST", "/api/admin/erps/ruim/test", { token: A });
    await rec("admin.erps.test.404", "POST", "/api/admin/erps/nada/test", { token: A });
    await rec("admin.erps.test.401", "POST", "/api/admin/erps/inovafarma/test");
    await rec("admin.erps.test.403", "POST", "/api/admin/erps/inovafarma/test", { token: V });
    await rec("admin.erps.delete.401", "DELETE", "/api/admin/erps/inovafarma");
    await rec("admin.erps.delete.403", "DELETE", "/api/admin/erps/inovafarma", { token: V });
    await rec("admin.erps.delete.ok", "DELETE", "/api/admin/erps/inovafarma", { token: A });
    await rec("admin.erps.delete.404", "DELETE", "/api/admin/erps/inovafarma", { token: A });

    });
  });

  describe("iam-grants", () => {
    it("rotas", async () => {
    // ── gestor não-admin limitado: a regra "só concede o que possui" fica congelada
    const gPerms = ["system:users:create", "system:users:update", "system:users:reset_password", "system:users:delete", "system:roles:create", "system:roles:update", "system:roles:read"];
    await rec("iam.grants.setup_role", "POST", "/api/iam/roles", { token: A, body: { id: "role_gestor", name: "Gestor Limitado", permissions: gPerms } });
    const mk = (username: string, roleId: string) => ({ fullname: "Usuario Grants", username, password: "Senha@456", roleId, externals: {} });
    tick();
    await rec("iam.grants.setup_gestor", "POST", "/api/iam/users", { token: A, body: mk("gestor.limitado", "role_gestor") });
    tick();
    const comum = await rec("iam.grants.setup_comum", "POST", "/api/iam/users", { token: A, body: mk("alvo.comum", "role_vendedor") });
    tick();
    const adm = await rec("iam.grants.setup_admin_alvo", "POST", "/api/iam/users", { token: A, body: mk("alvo.admin", "role_vendedor") });
    const comumId = (comum.raw as { id: string }).id;
    const admId = (adm.raw as { id: string }).id;
    await rec("iam.grants.setup_admin_flag", "PUT", `/api/iam/users/${admId}`, { token: R, body: { isAdmin: true } });
    const gl = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "gestor.limitado", password: "Senha@456" }),
    });
    const G = ((await gl.json()) as { access_token: string }).access_token;

    await rec("iam.grants.users.update.403_stronger_role", "PUT", `/api/iam/users/${comumId}`, { token: G, body: { roleId: "role_admin" } });
    await rec("iam.grants.users.update.ok_subset_role", "PUT", `/api/iam/users/${comumId}`, { token: G, body: { roleId: "role_vendedor" } });
    tick();
    await rec("iam.grants.users.create.403_stronger_role", "POST", "/api/iam/users", { token: G, body: mk("cumplice.um", "role_admin") });
    tick();
    await rec("iam.grants.users.create.ok_subset_role", "POST", "/api/iam/users", { token: G, body: mk("legitimo.um", "role_vendedor") });
    await rec("iam.grants.roles.create.403_missing_keys", "POST", "/api/iam/roles", { token: G, body: { id: "role_g_x", name: "Grupo GX", permissions: ["system:erps:manage"] } });
    await rec("iam.grants.roles.create.ok_owned_keys", "POST", "/api/iam/roles", { token: G, body: { id: "role_g_y", name: "Grupo GY", permissions: ["system:roles:read"] } });
    await rec("iam.grants.roles.update.403_add_missing_key", "PUT", "/api/iam/roles/role_gestor", { token: G, body: { permissions: [...gPerms, "system:erps:manage"] } });
    await rec("iam.grants.roles.update.ok_remove_key", "PUT", "/api/iam/roles/role_g_y", { token: G, body: { permissions: [] } });
    await rec("iam.grants.users.reset.403_target_admin", "POST", `/api/iam/users/${admId}/reset-password`, { token: G, body: { newPassword: "Nova@1234" } });
    await rec("iam.grants.users.update.403_inactivate_admin", "PUT", `/api/iam/users/${admId}`, { token: G, body: { status: "inactive" } });
    await rec("iam.grants.users.delete.403_target_admin", "DELETE", `/api/iam/users/${admId}`, { token: G });
    await rec("iam.grants.users.update.403_rename_admin", "PUT", `/api/iam/users/${admId}`, { token: G, body: { fullname: "Nome Trocado" } });
    await rec("iam.grants.users.update.ok_inactivate_common", "PUT", `/api/iam/users/${comumId}`, { token: G, body: { status: "inactive" } });
    await rec("iam.grants.users.delete.ok_common", "DELETE", `/api/iam/users/${comumId}`, { token: G });
    await rec("iam.grants.users.delete.ok_admin_by_admin", "DELETE", `/api/iam/users/${admId}`, { token: R });
    const rl = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "root.admin", password: TEST_PASSWORD }),
    });
    const R2 = ((await rl.json()) as { access_token: string }).access_token;
    await rec("iam.users.delete.409_self", "DELETE", `/api/iam/users/${rootId}`, { token: R2 });
    await rec("iam.users.update.409_last_admin_inactivate", "PUT", `/api/iam/users/${rootId}`, { token: R2, body: { status: "inactive" } });

    });
  });

  it("cobre exatamente as chaves da fixture", () => {
    if (!updating) expect(Object.keys(results).sort()).toEqual(Object.keys(expected).sort());
  });
});
