import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { sign } from "hono/jwt";
import { TokenService } from "../src/iam/token-service.js";
import { createPlatformApp } from "../src/index.js";
import { canGrant, grantDeniedMessage, missingGrants } from "../src/iam/can-grant.js";
import { SYSTEM_PERMISSION_KEYS } from "../src/iam/system-permissions.js";
import { hasPermission } from "../src/iam/has-permission.js";
import { PasswordService } from "../src/iam/password-service.js";
import { authHeader, createSeededUserStore, seededWorkspaces, TEST_PASSWORD } from "./helpers/fixtures.js";

const WS = "ws_fechamento_jan_2026";

describe("hardening de auth: permissão ausente falha fechado", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let semView: Record<string, string>;
  let curinga: Record<string, string>;

  beforeAll(async () => {
    const userStore = createSeededUserStore();
    await userStore.createRole({ id: "role_so_leitura", name: "Só leitura", description: "d", permissions: ["system:workspaces:read"] });
    await userStore.createUser({ fullname: "Teste Usuario", username: "sem.view", password: TEST_PASSWORD, roleId: "role_so_leitura", externals: {} });
    app = createPlatformApp({
      userStore,
      workspaces: seededWorkspaces.map((w) => ({ ...w })),
    });
    // Criado após o boot: o sync de órfãs remove "*" de roles existentes na inicialização.
    await userStore.createRole({ id: "role_curinga", name: "Curinga", description: "d", permissions: ["*"] });
    await userStore.createUser({ fullname: "Teste Usuario", username: "cur.inga", password: TEST_PASSWORD, roleId: "role_curinga", externals: {} });
    semView = await authHeader(app, "sem.view");
    curinga = await authHeader(app, "cur.inga");
  });

  it("sem permissão: mutações de workspace respondem 403; sem token, 401", async () => {
    const send = (method: string, path: string, headers: Record<string, string> = {}, body?: object) =>
      app.request(path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
    const novo = { name: "Nova", startDate: "2026-02-01", endDate: "2026-02-28" };
    expect((await send("POST", "/api/workspaces", semView, novo)).status).toBe(403);
    expect((await send("POST", `/api/workspaces/${WS}/conclude`, semView)).status).toBe(403);
    expect((await send("DELETE", `/api/workspaces/${WS}`, semView)).status).toBe(403);
    expect((await send("GET", "/api/workspaces")).status).toBe(401);
    expect((await send("POST", "/api/workspaces", {}, novo)).status).toBe(401);
  });

  it("curinga '*' não-admin acessa rotas system:* e workspaces", async () => {
    expect((await app.request("/api/iam/users", { headers: curinga })).status).toBe(200);
    expect((await app.request("/api/workspaces", { headers: curinga })).status).toBe(200);
  });

  it("role com '*' mantém o curinga após o sync de órfãs", async () => {
    const store = createSeededUserStore();
    await store.createRole({ id: "role_c", name: "Curinga", description: "d", permissions: ["*", "recipe:morto:view"] });
    await store.syncOrphanPermissions(SYSTEM_PERMISSION_KEYS);
    expect((await store.getRole("role_c"))?.permissions).toEqual(["*"]);
  });

  it("hasPermission falha fechado sem permissões", () => {
    expect(hasPermission(undefined, "x")).toBe(false);
    expect(hasPermission([], "x")).toBe(false);
    expect(hasPermission(["*"], "x")).toBe(true);
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
      app = createPlatformApp({ userStore: store });
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
        permissions: ["system:users:create", "system:users:update", "system:users:reset_password", "system:users:delete", "system:roles:create", "system:roles:update", "system:roles:read", "system:users:read"],
      });
      await store.createRole({ id: "role_pequeno", name: "Pequeno", description: "d", permissions: ["system:users:read"] });
      await store.createUser({ fullname: "Gestor Grants", username: "gestor.grants", password: TEST_PASSWORD, roleId: "role_gestor", externals: {} });
      const comum = await store.createUser({ fullname: "Alvo Comum", username: "alvo.comum", password: TEST_PASSWORD, roleId: "role_pequeno", externals: {} });
      const alvoAdmin = await store.createUser({ fullname: "Alvo Admin", username: "alvo.admin", password: TEST_PASSWORD, roleId: "role_pequeno", externals: {} });
      await store.setAdmin(alvoAdmin.id, true);
      alvoComumId = comum.id;
      alvoAdminId = alvoAdmin.id;
      app = createPlatformApp({ userStore: store });
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
      expect((await send("POST", "/api/iam/roles", gestor, { id: "role_g1", name: "G Um", permissions: ["system:sources:manage"] })).status).toBe(403);
      expect((await send("POST", "/api/iam/roles", gestor, { id: "role_g2", name: "G Dois", permissions: ["system:users:read"] })).status).toBe(201);
      expect((await send("PUT", "/api/iam/roles/role_gestor", gestor, { permissions: ["system:users:create", "system:users:update", "system:users:reset_password", "system:roles:create", "system:roles:update", "system:roles:read", "system:users:read", "system:sources:manage"] })).status).toBe(403);
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
      const many = Array.from({ length: 15 }, (_, i) => `system:x:k${i}`);
      const long = grantDeniedMessage(many);
      expect(long.split(", ").length).toBe(10);
      expect(long).toContain("e mais 5");
    });

    it("reset-password: usuário comum ok; admin alvo só por admin", async () => {
      const body = { newPassword: "Nova@12345" };
      expect((await send("POST", `/api/iam/users/${alvoComumId}/reset-password`, gestor, body)).status).toBe(200);
      const denied = await send("POST", `/api/iam/users/${alvoAdminId}/reset-password`, gestor, body);
      expect(denied.status).toBe(403);
      expect(((await denied.json()) as { error: string }).error).toBe("Somente administradores podem redefinir a senha de outro administrador.");
      expect((await send("POST", `/api/iam/users/${alvoAdminId}/reset-password`, admin, body)).status).toBe(200);
    });

    it("não-admin não exclui nem inativa admin; admin e usuário comum permitidos", async () => {
      const denied = await app.request(`/api/iam/users/${alvoAdminId}`, { method: "DELETE", headers: gestor });
      expect(denied.status).toBe(403);
      expect(((await denied.json()) as { error: string }).error).toBe("Somente administradores podem excluir ou inativar outro administrador.");
      expect((await send("PUT", `/api/iam/users/${alvoAdminId}`, gestor, { status: "inactive" })).status).toBe(403);
      for (const patch of [{ fullname: "Outro Nome" }, { email: "x@y.com" }, { externals: { sap: 1 } }, { roleId: "role_pequeno" }]) {
        const res = await send("PUT", `/api/iam/users/${alvoAdminId}`, gestor, patch);
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: string }).error).toBe("Somente administradores podem alterar outro administrador.");
      }
      expect((await send("PUT", `/api/iam/users/${alvoComumId}`, gestor, { status: "inactive" })).status).toBe(200);
      expect((await send("PUT", `/api/iam/users/${alvoAdminId}`, admin, { status: "inactive" })).status).toBe(200);
      expect((await app.request(`/api/iam/users/${alvoAdminId}`, { method: "DELETE", headers: admin })).status).toBe(200);
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

  describe("auto-exclusão e último administrador ativo", () => {
    let ger: Record<string, string>;
    let gerId = "";
    let root: Record<string, string>;
    const del = (id: string, h: Record<string, string>) => app.request(`/api/iam/users/${id}`, { method: "DELETE", headers: h });

    beforeAll(async () => {
      const store = createSeededUserStore({ admin: true });
      await store.createRole({ id: "role_del", name: "Del", description: "d", permissions: ["system:users:delete", "system:users:update"] });
      const g = await store.createUser({ fullname: "Gestor Del", username: "gestor.del", password: TEST_PASSWORD, roleId: "role_del", externals: {} });
      gerId = g.id;
      app = createPlatformApp({ userStore: store });
      ger = await authHeader(app, "gestor.del");
      root = await authHeader(app, "test.root");
    });

    it("não-admin não exclui a si mesmo (409)", async () => {
      const res = await del(gerId, ger);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toBe("Não é possível excluir a si mesmo.");
    });

    it("o único admin ativo não pode inativar a si mesmo nem ser excluído (409)", async () => {
      const users = (await (await app.request("/api/iam/users", { headers: root })).json()) as { id: string; username: string }[];
      const rootId = users.find((u) => u.username === "test.root")?.id ?? "";
      const inact = await app.request(`/api/iam/users/${rootId}`, { method: "PUT", headers: { ...root, "Content-Type": "application/json" }, body: JSON.stringify({ status: "inactive" }) });
      expect(inact.status).toBe(409);
      expect(((await inact.json()) as { error: string }).error).toBe("O sistema precisa de ao menos um administrador ativo.");
      expect((await del(rootId, root)).status).toBe(409);
    });
  });

  describe("refresh relê o usuário do store", () => {
    it("inativado ou excluído não renova; troca de role revoga o refresh e vale após novo login", async () => {
      const store = createSeededUserStore();
      await store.createRole({ id: "role_r1", name: "R Um", description: "d", permissions: ["system:users:read"] });
      await store.createRole({ id: "role_r2", name: "R Dois", description: "d", permissions: ["system:roles:read"] });
      const a = await store.createUser({ fullname: "Usuario Um", username: "refresh.um", password: TEST_PASSWORD, roleId: "role_r1", externals: {} });
      const b = await store.createUser({ fullname: "Usuario Dois", username: "refresh.dois", password: TEST_PASSWORD, roleId: "role_r1", externals: {} });
      const c = await store.createUser({ fullname: "Usuario Tres", username: "refresh.tres", password: TEST_PASSWORD, roleId: "role_r1", externals: {} });
      const local = createPlatformApp({ userStore: store });
      const login = async (username: string) => {
        const res = await local.request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: TEST_PASSWORD }) });
        return ((await res.json()) as { refresh_token: string }).refresh_token;
      };
      const refresh = (token: string) =>
        local.request("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: token }) });
      const ra = await login("refresh.um");
      const rb = await login("refresh.dois");
      const rc = await login("refresh.tres");
      await store.updateUser(a.id, { status: "inactive" });
      await store.deleteUser(b.id);
      await store.updateUser(c.id, { roleId: "role_r2" });
      expect((await refresh(ra)).status).toBe(401);
      expect((await refresh(rb)).status).toBe(401);
      expect((await refresh(rc)).status).toBe(401);
      const ok = await refresh(await login("refresh.tres"));
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { user: { permissions: string[] } };
      expect(body.user.permissions).toEqual(["system:roles:read"]);
    });
  });

  describe("segredo JWT", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("produção sem JWT_SECRET lança", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("JWT_SECRET", "");
      expect(() => new TokenService()).toThrow(/JWT_SECRET/);
    });

    it("segredo com menos de 32 caracteres lança", () => {
      expect(() => new TokenService({ jwtSecret: "curto" })).toThrow(/32/);
      vi.stubEnv("JWT_SECRET", "curto");
      expect(() => new TokenService()).toThrow(/32/);
    });

    it("token assinado com a constante antiga é rejeitado", async () => {
      vi.stubEnv("JWT_SECRET", "");
      const forged = await sign(
        { sub: "x", username: "x", permissions: ["*"], isAdmin: true, iat: 1, exp: 9999999999 },
        "sdui-platform-super-secret-key-2026"
      );
      const res = await app.request("/api/auth/me", { headers: { Authorization: `Bearer ${forged}` } });
      expect(res.status).toBe(401);
    });
  });

  describe("Áreas de Trabalho: datas e permissões", () => {
    let semView: Record<string, string>;

    beforeAll(async () => {
      const store = createSeededUserStore();
      await store.createRole({ id: "role_cria", name: "Cria", description: "d", permissions: ["system:workspaces:create"] });
      await store.createUser({ fullname: "Cria Sem Close", username: "cria.semclose", password: TEST_PASSWORD, roleId: "role_cria", externals: {} });
      app = createPlatformApp({ userStore: store, workspaces: seededWorkspaces.map((w) => ({ ...w })) });
      semView = await authHeader(app, "cria.semclose");
    });

    it("datas de workspace: YYYY-MM-DD estrito no POST e no PUT", async () => {
      const gerente = await authHeader(app, "carlos.admin");
      const put = (body: object) =>
        app.request(`/api/workspaces/${WS}`, { method: "PUT", headers: { "Content-Type": "application/json", ...gerente }, body: JSON.stringify(body) });
      expect((await put({ startDate: "abc" })).status).toBe(400);
      expect((await put({ endDate: "2026-02-30" })).status).toBe(400);
      expect((await put({ endDate: "2025-01-01" })).status).toBe(400);
      const post = await app.request("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...gerente },
        body: JSON.stringify({ name: "Fev", startDate: "01/02/2026", endDate: "2026-02-28" }),
      });
      expect(post.status).toBe(400);
      expect((await put({ endDate: "2026-02-10" })).status).toBe(200);
    });

    it("conclude e reopen exigem close/reopen; só create não basta", async () => {
      for (const action of ["conclude", "reopen"]) {
        const res = await app.request(`/api/workspaces/${WS}/${action}`, { method: "POST", headers: semView });
        expect(res.status).toBe(403);
      }
    });

    it("criar exige só system:workspaces:create e o corpo não tem recipeId", async () => {
      const res = await app.request("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...semView },
        body: JSON.stringify({ name: "Fev", startDate: "2026-02-01", endDate: "2026-02-28" }),
      });
      expect(res.status).toBe(201);
      expect(((await res.json()) as { recipeId?: string }).recipeId).toBeUndefined();
    });
  });

  describe("login sem enumeração de usuários", () => {
    it("mensagem única e hash verificado mesmo para usuário inexistente", async () => {
      const store = createSeededUserStore();
      const inativo = await store.createUser({ fullname: "Usuario Inativo", username: "usuario.inativo", password: TEST_PASSWORD, roleId: "role_vendedor", externals: {} });
      await store.updateUser(inativo.id, { status: "inactive" });
      const local = createPlatformApp({ userStore: store });
      const spy = vi.spyOn(PasswordService, "verify");
      const login = async (username: string, password: string) => {
        const res = await local.request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
        return { status: res.status, body: (await res.json()) as { error: string } };
      };
      const results = [
        await login("ninguem.existe", TEST_PASSWORD),
        await login("carlos.admin", "SenhaErrada@1"),
        await login("usuario.inativo", TEST_PASSWORD),
      ];
      for (const r of results) {
        expect(r.status).toBe(401);
        expect(r.body.error).toBe("Credenciais inválidas.");
      }
      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy.mock.calls[0][1]).not.toBe("");
      spy.mockRestore();
    });
  });

  describe("ids", () => {
    it("usuários criados no mesmo instante têm ids distintos (usr_ + uuid)", async () => {
      const store = createSeededUserStore();
      const input = { fullname: "Usuario Id", password: TEST_PASSWORD, roleId: "role_vendedor", externals: {} };
      const a = await store.createUser({ ...input, username: "id.um" });
      const b = await store.createUser({ ...input, username: "id.dois" });
      expect(a.id).toMatch(/^usr_[0-9a-f-]{36}$/);
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("CORS e cookie de acesso", () => {
    it("só reflete origens da allowlist", async () => {
      const ok = await app.request("/api/health", { headers: { Origin: "http://localhost:5173" } });
      expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
      const bad = await app.request("/api/health", { headers: { Origin: "https://evil.example" } });
      expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("cookie access_token não autentica", async () => {
      const header = await authHeader(app, "carlos.admin");
      const token = header.Authorization.slice("Bearer ".length);
      const res = await app.request("/api/auth/me", { headers: { Cookie: `access_token=${token}` } });
      expect(res.status).toBe(401);
    });
  });

  describe("erros de JWT genéricos", () => {
    it("não devolvem a mensagem interna da biblioteca", async () => {
      const me = await app.request("/api/auth/me", { headers: { Authorization: "Bearer lixo.lixo.lixo" } });
      expect(((await me.json()) as { error: string }).error).toBe("Falha na autenticação: token expirado ou inválido.");
      const refresh = await app.request("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: "lixo.lixo.lixo" }) });
      expect(refresh.status).toBe(401);
      expect(((await refresh.json()) as { error: string }).error).toBe("Refresh token inválido ou expirado.");
    });
  });
});
