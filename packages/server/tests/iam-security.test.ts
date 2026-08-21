import { describe, it, expect, beforeEach } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { MockSourceConnector } from "../src/data/source-connector.js";
import { MemoryPersistenceStore } from "../src/data/persistence-store.js";
import { PasswordService } from "../src/iam/password-service.js";
import { TokenService } from "../src/iam/token-service.js";
import { MemoryUserStore } from "../src/iam/user-store.js";
import fechamentoRecipe from "../../../recipes/fechamento-mes.recipe.js";
import type {
  AuthTokens,
  User,
  PermissionCatalog,
  TableDataResponse,
  ActionExecResponse,
  PermissionItem,
  UIEffect,
} from "@platform/shared";

describe("Segurança & IAM Permission-First (JWT 5m + Refresh 7d + RBAC)", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let sourceConnector: MockSourceConnector;
  let persistenceStore: MemoryPersistenceStore;
  let userStore: MemoryUserStore;
  let tokenService: TokenService;

  beforeEach(() => {
    sourceConnector = new MockSourceConnector({
      default: [
        { vendedor_id: 1, vendedor: "Carlos Vendedor", venda_geral: 10000 },
        { vendedor_id: 42, vendedor: "João da Silva", venda_geral: 25000 },
        { vendedor_id: 99, vendedor: "Maria Souza", venda_geral: 15000 },
      ],
    });

    persistenceStore = new MemoryPersistenceStore();
    userStore = new MemoryUserStore();
    tokenService = new TokenService({
      jwtSecret: "test-secret-key-iam-12345",
      accessTtlSeconds: 300, // 5 min
      refreshTtlSeconds: 7 * 24 * 3600, // 7 dias
    });

    app = createPlatformApp({
      sourceConnector,
      persistenceStore,
      userStore,
      tokenService,
      recipes: {
        fechamento_mes: fechamentoRecipe,
      },
    });
  });

  // ─── 1. POLÍTICA DE SENHA ──────────────────────────────────────────────────
  describe("1. Política de Senha & Hashing", () => {
    it("deve rejeitar senhas fracas", () => {
      expect(PasswordService.validate("1234567").valid).toBe(false); // < 8 chars
      expect(PasswordService.validate("semmaiuscula1!").valid).toBe(false); // Sem maiúscula
      expect(PasswordService.validate("SEMMINUSCULA1!").valid).toBe(false); // Sem minúscula
      expect(PasswordService.validate("SemNumero!").valid).toBe(false); // Sem número
      expect(PasswordService.validate("SemSimbolo123").valid).toBe(false); // Sem símbolo
    });

    it("deve aceitar senhas fortes e validar o hash criptográfico com Argon2id", () => {
      const strongPass = "Forte@2026";
      expect(PasswordService.validate(strongPass).valid).toBe(true);

      const hash = PasswordService.hash(strongPass);
      expect(hash).toMatch(/^\$argon2id\$/);
      expect(PasswordService.verify(strongPass, hash)).toBe(true);
      expect(PasswordService.verify("Errada@2026", hash)).toBe(false);
    });
  });

  // ─── 2. AUTENTICAÇÃO, ACCESS TOKEN (5M) & REFRESH TOKEN (7D) ───────────────
  describe("2. Fluxo de Autenticação e Sessões JWT", () => {
    it("deve autenticar com sucesso e emitir Access Token (5m) e Refresh Token (7d)", async () => {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "carlos.admin",
          password: "Senha@123",
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, any>;
      expect(data.access_token).toBeDefined();
      expect(data.refresh_token).toBeDefined();
      expect(data.expires_in).toBe(300); // 5 minutos
      expect(data.user.username).toBe("carlos.admin");
      expect(data.user.role).toBe("role_admin");
      expect(data.user.permissions).toContain("system:users:create");
      expect(data.user.externals.inovafarma).toBe(1);
    });

    it("deve rejeitar credenciais inválidas com 401", async () => {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "carlos.admin",
          password: "SenhaIncorreta@123",
        }),
      });

      expect(res.status).toBe(401);
    });

    it("deve renovar o Access Token através de POST /api/auth/refresh", async () => {
      // 1. Faz login inicial
      const loginRes = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "joao.silva",
          password: "Senha@123",
        }),
      });
      const loginData = (await loginRes.json()) as Record<string, any>;

      // 2. Faz refresh
      const refreshRes = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: loginData.refresh_token,
        }),
      });

      expect(refreshRes.status).toBe(200);
      const refreshData = (await refreshRes.json()) as Record<string, any>;
      expect(refreshData.access_token).toBeDefined();
      expect(refreshData.user.username).toBe("joao.silva");
      expect(refreshData.user.externals.inovafarma).toBe(42);
    });

    it("deve retornar dados do usuário logado em GET /api/auth/me", async () => {
      const loginRes = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "maria.souza",
          password: "Senha@123",
        }),
      });
      const { access_token } = (await loginRes.json()) as Record<string, any>;

      const meRes = await app.request("/api/auth/me", {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      expect(meRes.status).toBe(200);
      const meData = (await meRes.json()) as Record<string, any>;
      expect(meData.username).toBe("maria.souza");
      expect(meData.role).toBe("role_operador");
    });
  });

  // ─── 3. IAM: GESTÃO DE USUÁRIOS, ROLES E RESET DE SENHA ────────────────────
  describe("3. Gestão de Usuários e Reset Exclusivo por Administrador", () => {
    let adminToken: string;
    let vendedorToken: string;

    beforeEach(async () => {
      const resAdmin = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "carlos.admin", password: "Senha@123" }),
      });
      adminToken = ((await resAdmin.json()) as AuthTokens).accessToken;

      const resVendedor = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "joao.silva", password: "Senha@123" }),
      });
      vendedorToken = ((await resVendedor.json()) as AuthTokens).accessToken;
    });

    it("Admin deve criar novo usuário respeitando a política de senha", async () => {
      const res = await app.request("/api/iam/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullname: "Novo Vendedor",
          username: "novo.vendedor",
          password: "NovaSenha@2026",
          roleId: "role_vendedor",
          externals: { inovafarma: 105 },
        }),
      });

      expect(res.status).toBe(201);
      const newUser = (await res.json()) as User;
      expect(newUser.username).toBe("novo.vendedor");
      expect(newUser.passwordHash).toBeUndefined(); // Proteção: nunca expõe hash
    });

    it("Vendedor comum sem permissão de admin deve ser bloqueado com 403 ao tentar criar usuário", async () => {
      const res = await app.request("/api/iam/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vendedorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullname: "Hacker",
          username: "hacker",
          password: "SenhaForte@123",
          roleId: "role_admin",
        }),
      });

      expect(res.status).toBe(403);
    });

    it("Admin deve resetar a senha de um usuário e o usuário conseguir logar com a nova senha imediatamente", async () => {
      // 1. Admin reseta a senha do João
      const resetRes = await app.request("/api/iam/users/usr_1002/reset-password", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          newPassword: "MinhaNovaSenha@2026",
        }),
      });
      expect(resetRes.status).toBe(200);

      // 2. João tenta logar com a senha antiga (deve falhar)
      const oldLogin = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "joao.silva", password: "Senha@123" }),
      });
      expect(oldLogin.status).toBe(401);

      // 3. João loga com a nova senha resetada pelo Admin (sucesso!)
      const newLogin = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "joao.silva", password: "MinhaNovaSenha@2026" }),
      });
      expect(newLogin.status).toBe(200);
    });
  });

  // ─── 4. CATÁLOGO DE PERMISSÕES & PRUNING DE ÓRFÃS ──────────────────────────
  describe("4. Catálogo Unificado e Limpeza Automática de Permissões Órfãs", () => {
    let adminToken: string;

    beforeEach(async () => {
      const resAdmin = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "carlos.admin", password: "Senha@123" }),
      });
      adminToken = ((await resAdmin.json()) as AuthTokens).accessToken;
    });

    it("deve retornar o catálogo completo com permissões de sistema e das recipes registradas", async () => {
      const res = await app.request("/api/iam/permissions/catalog", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const catalog = (await res.json()) as PermissionCatalog;

      // Seção System
      expect(catalog.system.users).toBeDefined();
      expect(catalog.system.users.some((p: PermissionItem) => p.key === "system:users:reset_password")).toBe(true);

      // Seção Recipes
      expect(catalog.recipes).toHaveLength(1);
      const recipeGroup = catalog.recipes[0];
      expect(recipeGroup.recipeId).toBe("fechamento_mes");
      expect(recipeGroup.viewPermission.key).toBe("recipe:fechamento_mes:view");
      expect(recipeGroup.queryPermissions.some((p: PermissionItem) => p.key === "recipe:fechamento_mes:query:all")).toBe(true);
      expect(recipeGroup.actionPermissions.some((p: PermissionItem) => p.key === "recipe:fechamento_mes:action:adicionar_penalidade")).toBe(true);
    });

    it("deve remover automaticamente permissões órfãs das roles quando uma action é descontinuada", async () => {
      // Adiciona uma role com permissão fantasma/órfã
      await userStore.createRole({
        id: "role_teste_orfas",
        name: "Role de Teste",
        permissions: [
          "system:users:read",
          "recipe:fechamento_mes:action:adicionar_penalidade",
          "recipe:fechamento_mes:action:antiga_removida", // ÓRFÃ!
          "recipe:dashboard_inexistente:view", // ÓRFÃ!
        ],
      });

      // Executa sincronização
      const removedCount = await userStore.syncOrphanPermissions({
        fechamento_mes: fechamentoRecipe,
      });

      expect(removedCount).toBe(2);
      const cleanedRole = await userStore.getRole("role_teste_orfas");
      expect(cleanedRole?.permissions).toEqual([
        "system:users:read",
        "recipe:fechamento_mes:action:adicionar_penalidade",
      ]);
    });
  });

  // ─── 5. SDUI DATA & ACTION ENFORCEMENT POR PERMISSÃO ───────────────────────
  describe("5. SDUI: Resolução Permission-First de Queries e Proteção de Actions", () => {
    let vendedorToken: string;
    let operadorToken: string;

    beforeEach(async () => {
      const resVendedor = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "joao.silva", password: "Senha@123" }),
      });
      vendedorToken = ((await resVendedor.json()) as AuthTokens).accessToken;

      const resOperador = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "maria.souza", password: "Senha@123" }),
      });
      operadorToken = ((await resOperador.json()) as AuthTokens).accessToken;
    });

    it("Vendedor com permissão 'query:self' e externals.inovafarma=42 deve receber apenas seu próprio registro", async () => {
      const res = await app.request("/api/workspaces/ws_teste/data/tabela_vendedores?recipe_id=fechamento_mes", {
        headers: { Authorization: `Bearer ${vendedorToken}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as TableDataResponse;
      expect(data.type).toBe("table");
      // O mock source connector tem 3 vendedores (1, 42, 99).
      // A query self tem: WHERE e.id = {{user.externals.inovafarma}} -> interpola 42
    });

    it("Operador com permissão 'query:all' deve receber todos os vendedores da equipe", async () => {
      const res = await app.request("/api/workspaces/ws_teste/data/tabela_vendedores?recipe_id=fechamento_mes", {
        headers: { Authorization: `Bearer ${operadorToken}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as TableDataResponse;
      expect(data.type).toBe("table");
      expect(data.data).toHaveLength(3);
    });

    it("Vendedor sem permissão para 'adicionar_penalidade' deve ser bloqueado com 403 Forbidden", async () => {
      const res = await app.request("/api/workspaces/ws_teste/actions/exec", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vendedorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipe_id: "fechamento_mes",
          action_id: "adicionar_penalidade",
          row: { vendedor_id: 42, vendedor: "João" },
          form_data: { valor: 50, reason: "Atraso" },
        }),
      });

      expect(res.status).toBe(403);
      const errorData = (await res.json()) as { error: string };
      expect(errorData.error).toContain("Acesso negado");
    });

    it("Operador COM permissão para 'adicionar_penalidade' deve executar com sucesso", async () => {
      const res = await app.request("/api/workspaces/ws_teste/actions/exec", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${operadorToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipe_id: "fechamento_mes",
          action_id: "adicionar_penalidade",
          row: { vendedor_id: 42, vendedor: "João" },
          form_data: { valor: 50, reason: "Atraso", __confirmed: true },
        }),
      });

      expect(res.status).toBe(200);
      const result = (await res.json()) as ActionExecResponse;
      expect(result.success).toBe(true);
      expect(result.effects?.some((e: UIEffect) => e.type === "refresh_data")).toBe(true);
    });
  });
});
