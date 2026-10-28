import { CLOSING_PERIOD_PERMISSIONS } from "../src/closing-period/closing-period-permissions.js";
import { describe, it, expect, beforeEach } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { PasswordService } from "../src/iam/password-service.js";
import { TokenService } from "../src/iam/token-service.js";
import { MemoryUserStore } from "../src/iam/user-store.js";
import { SYSTEM_PERMISSION_KEYS } from "../src/iam/system-permissions.js";
import { createSeededUserStore } from "./helpers/fixtures.js";
import type {
  AuthTokens,
  User,
  PermissionCatalog,
  PermissionItem,
} from "@platform/shared";

interface AuthBody {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  username: string;
  role: string;
  user: { username: string; role: string; permissions: string[] };
}

describe("Segurança & IAM Permission-First (JWT 5m + Refresh 7d + RBAC)", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let userStore: MemoryUserStore;
  let tokenService: TokenService;

  beforeEach(() => {
    userStore = createSeededUserStore();
    tokenService = new TokenService({
      jwtSecret: "test-secret-key-iam-12345-0123456789",
      accessTtlSeconds: 300, // 5 min
      refreshTtlSeconds: 7 * 24 * 3600, // 7 dias
    });

    app = createPlatformApp({
      userStore,
      tokenService,
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
      const data = (await res.json()) as AuthBody;
      expect(data.access_token).toBeDefined();
      expect(data.refresh_token).toBeDefined();
      expect(data.expires_in).toBe(300); // 5 minutos
      expect(data.user.username).toBe("carlos.admin");
      expect(data.user.role).toBe("role_admin");
      expect(data.user.permissions).toContain("system:users:create");
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
      const loginData = (await loginRes.json()) as AuthBody;

      // 2. Faz refresh
      const refreshRes = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: loginData.refresh_token,
        }),
      });

      expect(refreshRes.status).toBe(200);
      const refreshData = (await refreshRes.json()) as AuthBody;
      expect(refreshData.access_token).toBeDefined();
      expect(refreshData.user.username).toBe("joao.silva");
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
      const { access_token } = (await loginRes.json()) as AuthBody;

      const meRes = await app.request("/api/auth/me", {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      expect(meRes.status).toBe(200);
      const meData = (await meRes.json()) as AuthBody;
      expect(meData.username).toBe("maria.souza");
      expect(meData.role).toBe("role_operador");
    });
  });

  // ─── 3. IAM: GESTÃO DE USUÁRIOS, ROLES E RESET DE SENHA ────────────────────
  describe("3. Gestão de Usuários e Reset Exclusivo por Administrador", () => {
    let adminToken: string;
    let colaboradorToken: string;

    beforeEach(async () => {
      const resAdmin = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "carlos.admin", password: "Senha@123" }),
      });
      adminToken = ((await resAdmin.json()) as AuthTokens).accessToken;

      const resColaborador = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "joao.silva", password: "Senha@123" }),
      });
      colaboradorToken = ((await resColaborador.json()) as AuthTokens).accessToken;
    });

    it("Admin deve criar novo usuário respeitando a política de senha", async () => {
      const res = await app.request("/api/iam/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullname: "Novo Colaborador",
          username: "novo.colaborador",
          password: "NovaSenha@2026",
          roleId: "role_colaborador",
        }),
      });

      expect(res.status).toBe(201);
      const newUser = (await res.json()) as User;
      expect(newUser.username).toBe("novo.colaborador");
      expect(newUser.passwordHash).toBeUndefined(); // Proteção: nunca expõe hash
    });

    it("Colaborador comum sem permissão de admin deve ser bloqueado com 403 ao tentar criar usuário", async () => {
      const res = await app.request("/api/iam/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${colaboradorToken}`,
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
  describe("4. Catálogo de Sistema e Limpeza Automática de Permissões Órfãs", () => {
    let adminToken: string;

    beforeEach(async () => {
      const resAdmin = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "carlos.admin", password: "Senha@123" }),
      });
      adminToken = ((await resAdmin.json()) as AuthTokens).accessToken;
    });

    it("deve retornar o catálogo apenas com permissões de sistema", async () => {
      const res = await app.request("/api/iam/permissions/catalog", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const catalog = (await res.json()) as PermissionCatalog;
      expect(Object.keys(catalog)).toEqual(["system"]);
      expect(catalog.system.users.some((p: PermissionItem) => p.key === "system:users:reset_password")).toBe(true);
      expect(catalog.system.recipes).toBeUndefined();
    });

    it("não existem mais as chaves system:recipes:*", () => {
      expect(SYSTEM_PERMISSION_KEYS.has("system:recipes:read")).toBe(false);
      expect(SYSTEM_PERMISSION_KEYS.has("system:recipes:manage")).toBe(false);
    });

    it("deve remover permissões órfãs das roles e preservar o curinga", async () => {
      await userStore.createRole({
        id: "role_teste_orfas",
        name: "Role de Teste",
        permissions: ["*", "system:users:read", "system:antiga:removida", "recipe:dashboard_inexistente:view"],
      });

      const removedCount = await userStore.syncOrphanPermissions(new Set([...SYSTEM_PERMISSION_KEYS, ...CLOSING_PERIOD_PERMISSIONS.items.map((p) => p.key)]));

      expect(removedCount).toBe(2);
      expect((await userStore.getRole("role_teste_orfas"))?.permissions).toEqual(["*", "system:users:read"]);
    });

    it("POST /api/iam/roles rejeita chaves fora do catálogo (inclusive recipe:*) com 400", async () => {
      const res = await app.request("/api/iam/roles", {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: "role_x", name: "Role X", permissions: ["recipe:fechamento_mes:view"] }),
      });
      expect(res.status).toBe(400);
    });
  });
});
