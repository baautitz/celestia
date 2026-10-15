import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { RecipeCompiler } from "./engine/compiler.js";
import { DataResolver } from "./data/data-resolver.js";
import { ActionExecutor } from "./engine/action-executor.js";
import { resolveSourceConnector, type SourceConnector, type SourceConnectorRegistry } from "./data/source-connector.js";
import { MemoryPersistenceStore, type PersistenceStore } from "./data/persistence-store.js";
import { MemoryRecipeStore, type RecipeStore } from "./data/recipe-store.js";
import { MemoryConnectionStore, type ConnectionStore } from "./data/connection-store.js";
import type { ConnectionRecord } from "./data/connection-store.js";
import { createConnector, readSecrets, type ConnectorFactory } from "./data/connection-factory.js";
import { ERP_TYPES, parseErpValues } from "./data/erp-types.js";
import { encryptSecret } from "./data/secret-box.js";
import { TokenService } from "./iam/token-service.js";
import { MemoryUserStore, type UserStore } from "./iam/user-store.js";
import { PasswordService, PasswordPolicySchema } from "./iam/password-service.js";
import { PermissionCatalogEngine } from "./iam/permission-catalog.js";
import { grantDeniedMessage, missingGrants } from "./iam/can-grant.js";
import { hasPermission } from "./iam/has-permission.js";
import { denyMessage } from "./iam/system-permissions.js";
import { PermissionResolver } from "./iam/permission-resolver.js";
import { NotFoundError } from "./engine/errors.js";
import { createAuthMiddleware, getAuthenticatedUser, requirePermission } from "./iam/middleware.js";
import type { WorkspaceStore } from "./data/workspace-store.js";
import type { RecipeDef, ActionDef, JWTAccessPayload, WorkspaceRecord } from "@platform/shared";

export interface CreatePlatformAppOptions {
  compiler?: RecipeCompiler;
  sourceConnector?: SourceConnector;
  sourceConnectors?: SourceConnectorRegistry;
  persistenceStore?: PersistenceStore;
  recipeStore?: RecipeStore;
  /** Ids de Modelos que existem no banco mas falharam ao compilar no boot: a limpeza de permissões órfãs é pulada para não apagá-las. */
  failedRecipeIds?: string[];
  connectionStore?: ConnectionStore;
  connectorFactory?: ConnectorFactory;
  userStore?: UserStore;
  tokenService?: TokenService;
  recipes?: Record<string, RecipeDef>;
  workspaces?: WorkspaceRecord[];
  /** Quando informado, as Áreas de Trabalho são gravadas nele a cada mudança (o Map em memória é só cache). */
  workspaceStore?: WorkspaceStore;
}

export function createPlatformApp(options?: CreatePlatformAppOptions) {
  const app = new Hono();

  // Middleware CORS para desenvolvimento e produção
  app.use(
    "*",
    cors({
      origin: (origin) => origin || "*",
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    })
  );
  const compiler = options?.compiler || new RecipeCompiler();
  const sourceConnector = options?.sourceConnector;
  const sourceConnectors = options?.sourceConnectors || {};
  const persistenceStore = options?.persistenceStore || new MemoryPersistenceStore();
  const recipeStore = options?.recipeStore || new MemoryRecipeStore();
  const connectionStore = options?.connectionStore || new MemoryConnectionStore();
  const connectorFactory = options?.connectorFactory || createConnector;
  const userStore = options?.userStore || new MemoryUserStore();
  const tokenService = options?.tokenService || new TokenService();
  const recipesMap = new Map<string, RecipeDef>(Object.entries(options?.recipes || {}));
  const workspaceStore = options?.workspaceStore;
  const workspacesMap = new Map<string, WorkspaceRecord>((options?.workspaces || []).map((w) => [w.id, w]));

  // Recarrega os Modelos do banco (ao clicar em atualizar na tela de Modelos): pega edições feitas direto no Postgres.
  // Um Modelo que não compila mantém a última versão válida em uso, e nada é removido das permissões nesse caso.
  // Os Modelos iniciais (opção recipes) vêm do banco no boot, então também podem ser removidos ao recarregar.
  const loadedFromStore = new Set<string>(Object.keys(options?.recipes || {}));
  async function reloadRecipesFromStore(): Promise<{ loaded: number; errors: { id: string; message: string }[] }> {
    const errors: { id: string; message: string }[] = [];
    const records = await recipeStore.list();
    const seen = new Set<string>();

    for (const record of records) {
      seen.add(record.id);
      try {
        const recipe = await compiler.compile(record.id, record.source);
        recipesMap.set(record.id, recipe);
        loadedFromStore.add(record.id);
      } catch (err: unknown) {
        errors.push({ id: record.id, message: err instanceof Error ? err.message : "Erro ao compilar o Modelo." });
      }
    }

    for (const id of Array.from(loadedFromStore)) {
      if (seen.has(id)) continue;
      loadedFromStore.delete(id);
      recipesMap.delete(id);
      compiler.invalidate(id);
    }

    if (errors.length === 0) await userStore.syncOrphanPermissions(Object.fromEntries(recipesMap));
    return { loaded: records.length - errors.length, errors };
  }

  // Sincroniza e limpa permissões órfãs das roles na inicialização.
  // Se algum Modelo falhou ao compilar, pula a limpeza: ele não é órfão, só está temporariamente quebrado.
  if (options?.failedRecipeIds?.length) {
    console.warn(
      `Limpeza de permissões órfãs ignorada: Modelos com erro (${options.failedRecipeIds.join(", ")}). Corrija e recarregue.`
    );
  } else {
    userStore.syncOrphanPermissions(Object.fromEntries(recipesMap));
  }

  // Middleware de Autenticação
  // Administrador (isAdmin) ignora a matriz de permissões: recebe todas as permissões válidas no momento da requisição.
  const withAdminBypass = (payload: JWTAccessPayload): JWTAccessPayload =>
    payload.isAdmin
      ? { ...payload, permissions: ["*", ...PermissionCatalogEngine.getAllValidPermissionKeys(Object.fromEntries(recipesMap))] }
      : payload;

  const auth = createAuthMiddleware(tokenService, withAdminBypass);

  // Exige ao menos uma das permissões; ausência de usuário/permissões nega (fail closed).
  const guard =
    (...keys: string[]): MiddlewareHandler =>
    async (c, next) => {
      const user = c.get("user") as JWTAccessPayload | undefined;
      if (!keys.some((key) => hasPermission(user?.permissions, key))) return c.json({ error: denyMessage(keys[0]) }, 403);
      await next();
    };

  // Helper para obter recipe registrada
  function getRecipe(recipeId: string): RecipeDef {
    const recipe = recipesMap.get(recipeId);
    if (!recipe) {
      throw new Error(`Recipe '${recipeId}' não encontrada.`);
    }
    return recipe;
  }

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // ─────────────────────────────────────────────────────────────
  // 1. ROTAS DE AUTENTICAÇÃO (JWT 5 min + Refresh 7 dias)
  // ─────────────────────────────────────────────────────────────

  // POST /api/auth/login
  app.post(
    "/api/auth/login",
    zValidator(
      "json",
      z.object({
        username: z.string(),
        password: z.string(),
      })
    ),
    async (c) => {
      const { username, password } = c.req.valid("json");
      const user = await userStore.findByUsername(username);

      if (!user || user.status === "inactive") {
        return c.json({ error: "Credenciais inválidas ou usuário inativo." }, 401);
      }

      const isPasswordValid = PasswordService.verify(password, user.passwordHash || "");
      if (!isPasswordValid) {
        return c.json({ error: "Credenciais inválidas." }, 401);
      }

      const role = await userStore.getRole(user.roleId);
      const { token: accessToken, payload } = await tokenService.generateAccessToken(user, role || undefined);
      const { token: refreshToken } = await tokenService.generateRefreshToken(user);

      // Define cookie seguro HttpOnly para refresh token (7 dias)
      setCookie(c, "refresh_token", refreshToken, {
        path: "/api/auth",
        httpOnly: true,
        sameSite: "Lax",
        maxAge: 7 * 24 * 3600,
      });

      return c.json({
        accessToken,
        refreshToken,
        expiresIn: 300,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 300, // 5 minutos em segundos
        user: withAdminBypass(payload),
      });
    }
  );

  // POST /api/auth/refresh (Silent Refresh via HttpOnly Cookie)
  app.post(
    "/api/auth/refresh",
    zValidator(
      "json",
      z.object({
        refresh_token: z.string().optional(),
      }).optional()
    ),
    async (c) => {
      const body = c.req.valid("json");
      const refreshToken = body?.refresh_token || getCookie(c, "refresh_token");

      if (!refreshToken) {
        return c.json({ error: "Refresh token não fornecido." }, 401);
      }

      try {
        const refreshPayload = await tokenService.verifyRefreshToken(refreshToken);
        const user = await userStore.findById(refreshPayload.sub);

        if (!user || user.status === "inactive") {
          return c.json({ error: "Usuário não encontrado ou inativo." }, 401);
        }

        const role = await userStore.getRole(user.roleId);
        const { token: newAccessToken, payload: userPayload } = await tokenService.generateAccessToken(
          user,
          role || undefined
        );
        const { token: newRefreshToken } = await tokenService.generateRefreshToken(user);

        setCookie(c, "refresh_token", newRefreshToken, {
          path: "/api/auth",
          httpOnly: true,
          sameSite: "Lax",
          maxAge: 7 * 24 * 3600,
        });

        return c.json({
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: 300,
          access_token: newAccessToken,
          refresh_token: newRefreshToken,
          expires_in: 300,
          user: withAdminBypass(userPayload),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Refresh token inválido ou expirado.";
        return c.json({ error: msg }, 401);
      }
    }
  );

  // POST /api/auth/logout
  app.post("/api/auth/logout", async (c) => {
    deleteCookie(c, "refresh_token", {
      path: "/api/auth",
    });
    return c.json({ success: true, message: "Sessão encerrada com sucesso." });
  });

  // GET /api/auth/me (Dados do usuário logado)
  app.get("/api/auth/me", auth, async (c) => {
    const userPayload = c.get("user");
    return c.json(userPayload);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. GESTÃO DE USUÁRIOS E ROLES (IAM Permission-First)
  // ─────────────────────────────────────────────────────────────

  // GET /api/iam/permissions/catalog
  app.get("/api/iam/permissions/catalog", auth, requirePermission("system:roles:read"), async (c) => {
    const catalog = PermissionCatalogEngine.buildCatalog(Object.fromEntries(recipesMap));
    return c.json(catalog);
  });

  // GET /api/iam/users
  // GET /api/iam/sources (ERPs cadastrados, para vincular identificadores do usuário; sem dados de acesso)
  app.get("/api/iam/sources", auth, requirePermission("system:users:read"), async (c) => {
    const records = await connectionStore.list();
    return c.json(records.map(({ id, name }) => ({ id, name })));
  });

  app.get("/api/iam/users", auth, requirePermission("system:users:read"), async (c) => {
    const users = await userStore.listUsers();
    return c.json(users);
  });

  // POST /api/iam/users
  app.post(
    "/api/iam/users",
    auth,
    requirePermission("system:users:create"),
    zValidator(
      "json",
      z.object({
        fullname: z.string().min(2),
        username: z.string().min(3),
        password: PasswordPolicySchema,
        roleId: z.string(),
        externals: z.record(z.union([z.string(), z.number()])).optional(),
        email: z.string().email().optional(),
      })
    ),
    async (c) => {
      const body = c.req.valid("json");
      const targetRole = await userStore.getRole(body.roleId);
      if (targetRole) {
        const denied = grantViolation(c, targetRole.permissions);
        if (denied) return denied;
      }
      try {
        const newUser = await userStore.createUser(body);
        return c.json(newUser, 201);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro ao criar usuário.";
        return c.json({ error: msg }, 400);
      }
    }
  );

  // PUT /api/iam/users/:id
  app.put(
    "/api/iam/users/:id",
    auth,
    requirePermission("system:users:update"),
    zValidator(
      "json",
      z.object({
        fullname: z.string().optional(),
        roleId: z.string().optional(),
        externals: z.record(z.union([z.string(), z.number()])).optional(),
        status: z.enum(["active", "inactive"]).optional(),
        email: z.string().email().optional(),
        isAdmin: z.boolean().optional(),
      })
    ),
    async (c) => {
      const id = c.req.param("id");
      const { isAdmin, ...body } = c.req.valid("json");
      const caller = c.get("user") as JWTAccessPayload;
      // Único caminho pela API para o flag de administrador: só quem já é admin altera, e ninguém se rebaixa.
      if (isAdmin !== undefined) {
        if (!caller.isAdmin) {
          return c.json({ error: "Somente administradores podem alterar o acesso de administrador." }, 403);
        }
        if (id === caller.sub && !isAdmin) {
          return c.json({ error: "Você não pode remover o seu próprio acesso de administrador." }, 400);
        }
      }
      if (body.status === "inactive" && !caller.isAdmin && (await userStore.findById(id))?.isAdmin) {
        return c.json({ error: ADMIN_TARGET_ONLY }, 403);
      }
      if (body.roleId) {
        const targetRole = await userStore.getRole(body.roleId);
        if (targetRole) {
          const denied = grantViolation(c, targetRole.permissions);
          if (denied) return denied;
        }
      }
      try {
        const updated = await userStore.updateUser(id, body);
        if (isAdmin !== undefined) {
          await userStore.setAdmin(id, isAdmin);
          updated.isAdmin = isAdmin;
        }
        return c.json(updated);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro ao atualizar usuário.";
        return c.json({ error: msg }, 400);
      }
    }
  );

  // POST /api/iam/users/:id/reset-password (Reset exclusivo pelo Administrador)
  app.post(
    "/api/iam/users/:id/reset-password",
    auth,
    requirePermission("system:users:reset_password"),
    zValidator(
      "json",
      z.object({
        newPassword: PasswordPolicySchema,
      })
    ),
    async (c) => {
      const id = c.req.param("id");
      const { newPassword } = c.req.valid("json");

      const target = await userStore.findById(id);
      if (target?.isAdmin && !getAuthenticatedUser(c).isAdmin) {
        return c.json({ error: "Somente administradores podem redefinir a senha de outro administrador." }, 403);
      }

      try {
        const newHash = PasswordService.hash(newPassword);
        await userStore.resetPassword(id, newHash);
        return c.json({ success: true, message: "Senha redefinida com sucesso." });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro ao redefinir senha.";
        return c.json({ error: msg }, 400);
      }
    }
  );

  // DELETE /api/iam/users/:id
  app.delete("/api/iam/users/:id", auth, requirePermission("system:users:delete"), async (c) => {
    const id = c.req.param("id");
    if (!getAuthenticatedUser(c).isAdmin && (await userStore.findById(id))?.isAdmin) {
      return c.json({ error: ADMIN_TARGET_ONLY }, 403);
    }
    try {
      await userStore.deleteUser(id);
      return c.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao excluir usuário.";
      return c.json({ error: msg }, 400);
    }
  });

  // GET /api/iam/roles
  app.get("/api/iam/roles", auth, requirePermission("system:roles:read"), async (c) => {
    const roles = await userStore.listRoles();
    return c.json(roles);
  });

  // Valida chaves de permissão contra o catálogo de permissões válidas
  function validatePermissionKeys(permissions: string[]): string[] {
    const validKeys = PermissionCatalogEngine.getAllValidPermissionKeys(Object.fromEntries(recipesMap));
    const invalid = permissions.filter((p) => p !== "*" && !validKeys.has(p));
    return invalid;
  }

  // Responde 403 quando o chamador tenta conceder chaves que não possui; devolve undefined se pode.
  const grantViolation = (c: Context, targets: readonly string[]) => {
    const caller = getAuthenticatedUser(c);
    const missing = missingGrants(caller.permissions, targets, caller.isAdmin === true);
    return missing.length > 0 ? c.json({ error: grantDeniedMessage(missing) }, 403) : undefined;
  };

  const ADMIN_TARGET_ONLY = "Somente administradores podem excluir ou inativar outro administrador.";

  const WILDCARD_ADMIN_ONLY = "Somente administradores podem conceder acesso total (*) a um grupo de acesso.";

  // POST /api/iam/roles
  app.post(
    "/api/iam/roles",
    auth,
    requirePermission("system:roles:create"),
    zValidator(
      "json",
      z.object({
        id: z.string().min(2),
        name: z.string().min(2),
        description: z.string().optional(),
        permissions: z.array(z.string()),
      })
    ),
    async (c) => {
      const body = c.req.valid("json");
      if (body.permissions.includes("*") && !getAuthenticatedUser(c).isAdmin) {
        return c.json({ error: WILDCARD_ADMIN_ONLY }, 403);
      }

      const invalid = validatePermissionKeys(body.permissions);
      if (invalid.length > 0) {
        return c.json({ error: `Permissões inválidas: ${invalid.join(", ")}` }, 400);
      }
      const denied = grantViolation(c, body.permissions);
      if (denied) return denied;

      try {
        const created = await userStore.createRole(body);
        return c.json(created, 201);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro ao criar grupo.";
        return c.json({ error: msg }, 400);
      }
    }
  );

  // PUT /api/iam/roles/:id
  app.put(
    "/api/iam/roles/:id",
    auth,
    requirePermission("system:roles:update"),
    zValidator(
      "json",
      z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        permissions: z.array(z.string()).optional(),
      })
    ),
    async (c) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");

      // Alterar a posse do curinga "*" (conceder ou retirar) é ato de administrador.
      if (body.permissions && !getAuthenticatedUser(c).isAdmin) {
        const current = (await userStore.getRole(id))?.permissions ?? [];
        if (body.permissions.includes("*") !== current.includes("*")) {
          return c.json({ error: WILDCARD_ADMIN_ONLY }, 403);
        }
      }

      if (body.permissions) {
        const invalid = validatePermissionKeys(body.permissions);
        if (invalid.length > 0) {
          return c.json({ error: `Permissões inválidas: ${invalid.join(", ")}` }, 400);
        }
        // Só as chaves ADICIONADAS precisam ser possuídas; remover é permitido.
        const current = (await userStore.getRole(id))?.permissions ?? [];
        const denied = grantViolation(c, body.permissions.filter((key) => !current.includes(key)));
        if (denied) return denied;
      }

      try {
        const updated = await userStore.updateRole(id, body);
        return c.json(updated);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro ao atualizar grupo.";
        return c.json({ error: msg }, 400);
      }
    }
  );

  // ─────────────────────────────────────────────────────────────
  // 2.1 GESTÃO DE MODELOS EM RUNTIME (código-fonte TypeScript no banco)
  // ─────────────────────────────────────────────────────────────

  // GET /api/admin/recipes
  app.get("/api/admin/recipes", auth, requirePermission("system:recipes:read"), async (c) => {
    const records = await recipeStore.list();
    return c.json(records.map(({ id, createdAt, updatedAt }) => ({ id, name: recipesMap.get(id)?.name, createdAt, updatedAt })));
  });

  // POST /api/admin/recipes/reload (relê os Modelos do banco e recompila os alterados)
  app.post("/api/admin/recipes/reload", auth, requirePermission("system:recipes:manage"), async (c) => {
    return c.json(await reloadRecipesFromStore());
  });

  // GET /api/admin/recipes/:id
  app.get("/api/admin/recipes/:id", auth, requirePermission("system:recipes:read"), async (c) => {
    const record = await recipeStore.get(c.req.param("id"));
    if (!record) return c.json({ error: "Modelo não encontrado." }, 404);
    return c.json(record);
  });

  // PUT /api/admin/recipes/:id (cria ou atualiza; compila e valida antes de gravar)
  app.put(
    "/api/admin/recipes/:id",
    auth,
    requirePermission("system:recipes:manage"),
    zValidator("json", z.object({ source: z.string().min(1) })),
    async (c) => {
      const id = c.req.param("id");
      const { source } = c.req.valid("json");

      let recipe: RecipeDef;
      try {
        recipe = await compiler.compile(id, source);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro ao compilar o Modelo.";
        return c.json({ error: msg }, 400);
      }

      const record = await recipeStore.save(id, source);
      loadedFromStore.add(id);
      recipesMap.set(id, recipe);
      await userStore.syncOrphanPermissions(Object.fromEntries(recipesMap));
      return c.json(record);
    }
  );

  // DELETE /api/admin/recipes/:id
  app.delete("/api/admin/recipes/:id", auth, requirePermission("system:recipes:manage"), async (c) => {
    const id = c.req.param("id");
    if (!(await recipeStore.get(id))) return c.json({ error: "Modelo não encontrado." }, 404);
    await recipeStore.delete(id);
    loadedFromStore.delete(id);
    compiler.invalidate(id);
    recipesMap.delete(id);
    await userStore.syncOrphanPermissions(Object.fromEntries(recipesMap));
    return c.json({ success: true });
  });

  // ─────────────────────────────────────────────────────────────
  // 2.2 GESTÃO DE CONEXÕES COM FONTES DE DADOS (a senha nunca é devolvida)
  // ─────────────────────────────────────────────────────────────

  const publicConnection = ({ secretsEncrypted: _omit, ...rest }: ConnectionRecord) => rest;

  // GET /api/admin/erp-types (catálogo de tipos de ERP e os campos de cada um)
  app.get("/api/admin/erp-types", auth, requirePermission("system:sources:manage"), (c) =>
    c.json(Object.values(ERP_TYPES).map(({ id, label, fields }) => ({ id, label, fields })))
  );

  // GET /api/admin/connections
  app.get("/api/admin/connections", auth, requirePermission("system:sources:manage"), async (c) => {
    return c.json((await connectionStore.list()).map(publicConnection));
  });

  // PUT /api/admin/connections/:id (o id é o nome da fonte usado nos Modelos)
  app.put(
    "/api/admin/connections/:id",
    auth,
    requirePermission("system:sources:manage"),
    zValidator(
      "json",
      z.object({
        name: z.string().min(1),
        type: z.string().min(1),
        values: z.record(z.unknown()),
      })
    ),
    async (c) => {
      const id = c.req.param("id");
      if (!/^[a-z][a-z0-9_]*$/.test(id)) {
        return c.json({ error: "O id da conexão deve usar letras minúsculas, números e _ (ex.: inovafarma)." }, 400);
      }
      const { name, type, values } = c.req.valid("json");
      const typeDef = ERP_TYPES[type];
      if (!typeDef) return c.json({ error: `Tipo de ERP '${type}' não suportado.` }, 400);

      const existing = await connectionStore.get(id);
      let parsed: ReturnType<typeof parseErpValues>;
      try {
        // Segredo em branco numa edição mantém o valor salvo (só se o tipo não mudou).
        parsed = parseErpValues(typeDef, values, existing && existing.type === type ? readSecrets(existing) : {});
      } catch (err: unknown) {
        return c.json({ error: err instanceof Error ? err.message : "Valores inválidos." }, 400);
      }

      const record = await connectionStore.save({
        id,
        name,
        type,
        config: parsed.config,
        secretsEncrypted: encryptSecret(JSON.stringify(parsed.secrets)),
      });
      await sourceConnectors[id]?.close?.();
      sourceConnectors[id] = connectorFactory(record);
      return c.json(publicConnection(record));
    }
  );

  // POST /api/admin/connections/:id/test
  app.post("/api/admin/connections/:id/test", auth, requirePermission("system:sources:manage"), async (c) => {
    const connector = sourceConnectors[c.req.param("id")];
    if (!connector) return c.json({ error: "Conexão não encontrada." }, 404);
    const ok = (await connector.healthCheck?.()) ?? false;
    return c.json({ ok }, ok ? 200 : 502);
  });

  // DELETE /api/admin/connections/:id
  app.delete("/api/admin/connections/:id", auth, requirePermission("system:sources:manage"), async (c) => {
    const id = c.req.param("id");
    if (!(await connectionStore.get(id))) return c.json({ error: "Conexão não encontrada." }, 404);
    await connectionStore.delete(id);
    await sourceConnectors[id]?.close?.();
    delete sourceConnectors[id];
    return c.json({ success: true });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. WORKSPACES & SDUI CORE ROUTES (Permission-First)
  // ─────────────────────────────────────────────────────────────

  // 1. GET /api/workspaces (Lista todas as Áreas de Trabalho, com filtro opcional por Modelo)
  app.get(
    "/api/workspaces",
    auth,
    guard("system:workspaces:read"),
    zValidator("query", z.object({ recipe_id: z.string().optional() })),
    (c) => {
      const { recipe_id } = c.req.valid("query");
      let list = Array.from(workspacesMap.values()).reverse();
      if (recipe_id) {
        list = list.filter((ws) => ws.recipeId === recipe_id);
      }
      return c.json(list);
    }
  );

  // 2. GET /api/workspaces/:id (Detalhes e status da Área de Trabalho)
  app.get(
    "/api/workspaces/:id",
    auth,
    guard("system:workspaces:read"),
    zValidator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const ws = workspacesMap.get(id);
      if (!ws) return c.json({ error: "Área de Trabalho não encontrada." }, 404);
      return c.json(ws);
    }
  );

  // 3. POST /api/workspaces (Criação de nova Área de Trabalho com datas obrigatórias)
  app.post(
    "/api/workspaces",
    auth,
    guard("system:workspaces:create"),
    zValidator(
      "json",
      z
        .object({
          name: z.string().optional(),
          recipeId: z.string(),
          startDate: z.string(),
          endDate: z.string(),
          params: z.record(z.unknown()).optional(),
        })
        .refine(
          (data) => {
            const start = new Date(data.startDate);
            const end = new Date(data.endDate);
            return end.getTime() >= start.getTime();
          },
          {
            message: "A Data Final não pode ser anterior à Data Inicial.",
            path: ["endDate"],
          }
        )
    ),
    async (c) => {
      const body = c.req.valid("json");

      let recipe: RecipeDef;
      try {
        recipe = getRecipe(body.recipeId);
      } catch {
        return c.json({ error: `Modelo '${body.recipeId}' não encontrado.` }, 400);
      }

      const id = `ws_${Date.now()}`;
      const newWs: WorkspaceRecord = {
        id,
        recipeId: recipe.id,
        name: body.name || `${recipe.name} (${body.startDate} a ${body.endDate})`,
        startDate: body.startDate,
        endDate: body.endDate,
        status: "open",
        params: body.params,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      workspacesMap.set(id, newWs);
      await workspaceStore?.save(newWs);
      return c.json(newWs, 201);
    }
  );

  // 3.1 PUT /api/workspaces/:id (Edição de título, período e parâmetros)
  app.put(
    "/api/workspaces/:id",
    auth,
    guard("system:workspaces:update"),
    zValidator("param", z.object({ id: z.string() })),
    zValidator(
      "json",
      z.object({
        name: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        params: z.record(z.unknown()).optional(),
      })
    ),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");

      const ws = workspacesMap.get(id);
      if (!ws) {
        return c.json({ error: "Área de Trabalho não encontrada." }, 404);
      }

      // Proteção temporal estrita considerando o período resultante (mesclado)
      const startDate = body.startDate ?? ws.startDate;
      const endDate = body.endDate ?? ws.endDate;
      if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
        return c.json({ error: "A Data Final não pode ser anterior à Data Inicial." }, 400);
      }

      if (body.name !== undefined) ws.name = body.name;
      ws.startDate = startDate;
      ws.endDate = endDate;
      if (body.params !== undefined) ws.params = body.params;
      ws.updatedAt = new Date().toISOString();
      await workspaceStore?.save(ws);

      return c.json(ws);
    }
  );

  // 4. POST /api/workspaces/:id/conclude (Conclui e bloqueia a Área de Trabalho)
  app.post(
    "/api/workspaces/:id/conclude",
    auth,
    guard("system:workspaces:close", "system:workspaces:create"),
    zValidator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param");

      const ws = workspacesMap.get(id);
      if (!ws) return c.json({ error: "Área de Trabalho não encontrada." }, 404);
      ws.status = "closed";
      ws.updatedAt = new Date().toISOString();
      await workspaceStore?.save(ws);

      return c.json({ success: true, workspace: ws });
    }
  );

  // 5. POST /api/workspaces/:id/reopen (Reabre a Área de Trabalho concluída)
  app.post(
    "/api/workspaces/:id/reopen",
    auth,
    guard("system:workspaces:reopen", "system:workspaces:create"),
    zValidator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param");

      const ws = workspacesMap.get(id);
      if (!ws) return c.json({ error: "Área de Trabalho não encontrada." }, 404);
      ws.status = "open";
      ws.updatedAt = new Date().toISOString();
      await workspaceStore?.save(ws);

      return c.json({ success: true, workspace: ws });
    }
  );

  // 5.1 DELETE /api/workspaces/:id (Exclui Área de Trabalho — permission-first)
  app.delete(
    "/api/workspaces/:id",
    auth,
    guard("system:workspaces:delete"),
    zValidator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param");

      const ws = workspacesMap.get(id);
      if (!ws) {
        return c.json({ error: "Área de Trabalho não encontrada." }, 404);
      }

      workspacesMap.delete(id);
      await workspaceStore?.remove(id);
      return c.json({ success: true });
    }
  );

  // 5.1 GET /api/recipes (Catálogo de Modelos disponíveis, filtrado por permissão de visualização)
  app.get("/api/recipes", auth, async (c) => {
    const user = getAuthenticatedUser(c);

    let catalog = Array.from(recipesMap.values()).map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      description: recipe.description,
    }));

    // Quem gerencia permissões precisa enxergar todos os Modelos para configurar o acesso a eles.
    if (!hasPermission(user.permissions, "system:roles:update")) {
      catalog = catalog.filter((item) => PermissionResolver.canViewRecipe(item.id, user.permissions));
    }

    return c.json(catalog);
  });

  // 5.2 GET /api/lookups (Opções de um campo com lookup definido no Modelo)
  app.get(
    "/api/lookups",
    auth,
    zValidator("query", z.object({ recipe_id: z.string(), field: z.string() })),
    async (c) => {
      const { recipe_id, field } = c.req.valid("query");
      const user = getAuthenticatedUser(c);

      if (!PermissionResolver.canViewRecipe(recipe_id, user.permissions)) {
        return c.json({ error: denyMessage(`recipe:${recipe_id}:view`) }, 403);
      }

      let recipe: RecipeDef;
      try {
        recipe = getRecipe(recipe_id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Modelo não encontrado.";
        return c.json({ error: msg }, 404);
      }

      const fieldDef = recipe.workspace.params.find((p) => p.name === field);
      if (!fieldDef || !("lookup" in fieldDef) || !fieldDef.lookup) {
        return c.json(
          { error: `Campo '${field}' não possui configuração de lookup no Modelo '${recipe_id}'.` },
          400
        );
      }

      try {
        const lookupConnector = resolveSourceConnector(fieldDef.lookup.source, sourceConnectors, sourceConnector);
        const rows = await lookupConnector.query(fieldDef.lookup.query);
        const valueKey = fieldDef.lookup.valueKey || "value";
        const labelKey = fieldDef.lookup.labelKey || "label";

        const options = rows.map((row) => ({
          value: row[valueKey] as string | number,
          label: String(row[labelKey] ?? ""),
        }));

        return c.json(options);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro ao consultar opções do lookup.";
        return c.json({ error: msg }, 500);
      }
    }
  );

  // 6. GET /api/dashboards/:id/schema (Retorna o UI Schema sanitizado sem código SQL)
  app.get(
    "/api/dashboards/:id/schema",
    auth,
    zValidator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const recipe = recipesMap.get(id);
      if (!recipe) return c.json({ error: `Modelo '${id}' não encontrado.` }, 404);
      const user = getAuthenticatedUser(c);
      if (!PermissionResolver.canViewRecipe(recipe.id, user.permissions)) {
        return c.json({ error: denyMessage(`recipe:${recipe.id}:view`) }, 403);
      }

      const filteredActions = recipe.actions.filter((a: ActionDef) =>
        PermissionResolver.canExecuteAction({
          recipeId: recipe.id,
          actionDef: a,
          userPermissions: user.permissions,
        })
      );

      const schemaComponents = recipe.ui.components.map((component) => ({
        ...component,
        props: {
          ...component.props,
          availableProfiles: DataResolver.getComponentProfileMetadata(
            recipe,
            component,
            user.permissions
          ),
        },
      }));

      const uiSchema = {
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        workspace: recipe.workspace,
        actions: filteredActions.map((a: ActionDef) => ({
          id: a.id,
          label: a.label,
          icon: a.icon,
          variant: a.variant,
          nature: a.nature || "mutation",
          permission: a.permission,
        })),
        ui: { ...recipe.ui, components: schemaComponents },
      };

      return c.json(uiSchema);
    }
  );

  // 2. GET /api/workspaces/:id/data/:componentId (Retorna dados do componente resolvidos com IAM)
  app.get(
    "/api/workspaces/:id/data/:componentId",
    auth,
    zValidator("param", z.object({ id: z.string(), componentId: z.string() })),
    zValidator(
      "query",
      z
        .object({
          recipe_id: z.string().default("fechamento_mes"),
          page: z.coerce.number().default(1),
          page_size: z.coerce.number().default(10),
          start_date: z.string().default("2026-01-01"),
          end_date: z.string().default("2026-01-31"),
          sort_by: z.string().optional(),
          order: z.enum(["asc", "desc"]).optional(),
          search: z.string().optional(),
          profile_id: z.string().optional(),
          // Parâmetros do Modelo (JSON) para uso sem Área de Trabalho, como na prévia do Modelo.
          params: z.string().optional(),
        })
        .refine(
          (data) => {
            const start = new Date(data.start_date);
            const end = new Date(data.end_date);
            return end.getTime() >= start.getTime();
          },
          {
            message: "A Data Final não pode ser anterior à Data Inicial.",
            path: ["end_date"],
          }
        )
    ),
    async (c) => {
      const { id: workspaceId, componentId } = c.req.valid("param");
      const query = c.req.valid("query");
      const recipe = recipesMap.get(query.recipe_id);
      if (!recipe) return c.json({ error: `Modelo '${query.recipe_id}' não encontrado.` }, 404);
      const user = getAuthenticatedUser(c);
      if (!PermissionResolver.canViewRecipe(recipe.id, user.permissions)) {
        return c.json({ error: denyMessage(`recipe:${recipe.id}:view`) }, 403);
      }

      // Só aceita parâmetros declarados no Modelo; chegam à consulta sempre como bind parameters.
      let requestParams: Record<string, unknown> | undefined;
      if (query.params) {
        try {
          const parsed: unknown = JSON.parse(query.params);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          const declared = new Set(recipe.workspace.params.map((param) => param.name));
          requestParams = Object.fromEntries(Object.entries(parsed).filter(([name]) => declared.has(name)));
        } catch {
          return c.json({ error: "O parâmetro 'params' deve ser um objeto JSON." }, 400);
        }
      }

      try {
        const result = await DataResolver.resolveComponentData({
          recipe,
          workspaceId,
          componentId,
          sourceConnector,
          sourceConnectors,
          persistenceStore,
          profileId: query.profile_id,
          context: {
            workspace: {
              startDate: query.start_date,
              endDate: query.end_date,
              params: workspacesMap.get(workspaceId)?.params ?? requestParams,
            },
            user: {
              id: user.sub,
              role: user.role,
              permissions: user.permissions,
              externals: user.externals,
            },
          },
          pagination: {
            page: query.page,
            pageSize: query.page_size,
            sortBy: query.sort_by,
            order: query.order,
            search: query.search,
          },
        });

        return c.json(result);
      } catch (err: unknown) {
        if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
        const msg = err instanceof Error ? err.message : "Erro ao carregar dados.";
        if (msg.includes("Acesso negado")) {
          return c.json({ error: msg }, 403);
        }
        if (msg.includes("Data Inicial") || msg.includes("Data Final") || msg.includes("datas")) {
          return c.json({ error: msg }, 400);
        }
        return c.json({ error: msg }, 500);
      }
    }
  );

  // 3. POST /api/workspaces/:id/actions/exec (Executa RPC de ação operacional com verificação de permissão)
  app.post(
    "/api/workspaces/:id/actions/exec",
    auth,
    zValidator("param", z.object({ id: z.string() })),
    zValidator(
      "json",
      z.object({
        recipe_id: z.string().default("fechamento_mes"),
        component_id: z.string(),
        action_id: z.string(),
        row: z.record(z.unknown()),
        form_data: z.record(z.unknown()).optional(),
        workspace_version: z.number().default(1),
      })
    ),
    async (c) => {
      const { id: workspaceId } = c.req.valid("param");
      const body = c.req.valid("json");
      const recipe = recipesMap.get(body.recipe_id);
      if (!recipe) return c.json({ error: `Modelo '${body.recipe_id}' não encontrado.` }, 404);
      const user = getAuthenticatedUser(c);
      if (!PermissionResolver.canViewRecipe(recipe.id, user.permissions)) {
        return c.json({ error: denyMessage(`recipe:${recipe.id}:view`) }, 403);
      }

      const component = recipe.ui.components.find((item) => item.id === body.component_id);
      if (!component || component.component !== "data_table") {
        return c.json(
          { error: `Componente de origem '${body.component_id}' não encontrado ou não suporta actions de linha.` },
          400
        );
      }

      const actionBinding = component.props.bindings?.find((binding) => binding.primary) || component.props.bindings?.[0];
      const actionSource = actionBinding?.source || component.props.source;
      const actionQuery = actionBinding?.query || component.props.query;
      if (!actionSource || !actionQuery) {
        return c.json({ error: "O componente de origem não possui source/query para executar a action." }, 400);
      }

      // Trava de execução se a Área de Trabalho estiver concluída para ações de modificação
      const ws = workspacesMap.get(workspaceId);
      const actionDef = recipe.actions.find((a: ActionDef) => a.id === body.action_id);
      if (!actionDef) {
        return c.json({ error: `Ação '${body.action_id}' não encontrada no Modelo '${recipe.id}'.` }, 404);
      }
      if (!PermissionResolver.canExecuteAction({ recipeId: recipe.id, actionDef, userPermissions: user.permissions })) {
        return c.json(
          { error: `Acesso negado: o usuário não possui permissão para executar a ação '${actionDef.label || actionDef.id}'.` },
          403
        );
      }
      const isMutation = actionDef.nature !== "read";

      if (ws && ws.status === "closed" && isMutation) {
        return c.json(
          { error: "Esta Área de Trabalho está concluída e bloqueada para ações de modificação." },
          400
        );
      }

      try {
        const result = await ActionExecutor.execute({
          recipe,
          actionId: body.action_id,
          sourceName: actionSource,
          queryName: actionQuery,
          row: body.row,
          formData: body.form_data,
          workspaceId,
          workspaceVersion: body.workspace_version,
          persistenceStore,
          userPermissions: user.permissions,
        });

        return c.json(result);
      } catch (err: unknown) {
        if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
        const msg = err instanceof Error ? err.message : "Erro na execução da ação.";
        if (msg.includes("Acesso negado")) {
          return c.json({ error: msg }, 403);
        }
        return c.json({ error: msg }, 500);
      }
    }
  );

  // 4. POST /api/workspaces/:id/persistence/set (Auto-save de edição inline em células)
  app.post(
    "/api/workspaces/:id/persistence/set",
    auth,
    guard("system:workspaces:update"),
    zValidator("param", z.object({ id: z.string() })),
    zValidator(
      "json",
      z.object({
        target: z.string(),
        target_foreign_key_value: z.union([z.string(), z.number()]),
        field: z.string(),
        value: z.unknown(),
        workspace_version: z.number().default(1),
      })
    ),
    async (c) => {
      const { id: workspaceId } = c.req.valid("param");
      const body = c.req.valid("json");

      // Trava de edição se a Área de Trabalho estiver concluída
      const ws = workspacesMap.get(workspaceId);
      if (!ws) return c.json({ error: "Área de Trabalho não encontrada." }, 404);
      if (ws.status === "closed") {
        return c.json(
          { error: "Esta Área de Trabalho está concluída e bloqueada para edições." },
          400
        );
      }

      await persistenceStore.setScalar(
        workspaceId,
        body.target,
        body.target_foreign_key_value,
        { [body.field]: body.value }
      );

      return c.json({
        success: true,
        new_version: body.workspace_version + 1,
      });
    }
  );

  // 5. GET /api/workspaces/:id/persistence/collection/:collection/:foreignKeyValue (Consulta itens de sub-tabelas)
  app.get(
    "/api/workspaces/:id/persistence/collection/:collection/:foreignKeyValue",
    auth,
    guard("system:workspaces:read"),
    zValidator("param", z.object({ id: z.string(), collection: z.string(), foreignKeyValue: z.string() })),
    async (c) => {
      const { id: workspaceId, collection, foreignKeyValue } = c.req.valid("param");
      if (!workspacesMap.has(workspaceId)) return c.json({ error: "Área de Trabalho não encontrada." }, 404);
      const items = await persistenceStore.getItems(workspaceId, collection, foreignKeyValue);
      const formatted = items.map((item) => ({
        id: item.id,
        created_at: item.createdAt,
        ...item.data,
      }));
      return c.json(formatted);
    }
  );

  return app;
}

export type AppType = ReturnType<typeof createPlatformApp>;

// Inicia servidor se executado diretamente
if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test" && !process.env?.VITEST) {
  void (async () => {
    let persistenceStore: PersistenceStore | undefined;
    let userStore: UserStore | undefined;
    let recipeStore: RecipeStore | undefined;
    const sourceConnectors: SourceConnectorRegistry = {};
    let connectionStore: ConnectionStore | undefined;
    let workspaceStore: WorkspaceStore | undefined;
    let workspaces: WorkspaceRecord[] = [];
    const recipes: Record<string, RecipeDef> = {};
    const failedRecipeIds: string[] = [];
    if (process.env.POSTGRES_HOST) {
      const [{ db }, { PostgresPersistenceStore }, { PostgresUserStore }, { PostgresRecipeStore }, { PostgresConnectionStore }, { PostgresWorkspaceStore }] = await Promise.all([
        import("./db/client.js"),
        import("./data/postgres-persistence-store.js"),
        import("./iam/postgres-user-store.js"),
        import("./data/postgres-recipe-store.js"),
        import("./data/postgres-connection-store.js"),
        import("./data/postgres-workspace-store.js"),
      ]);
      persistenceStore = new PostgresPersistenceStore(db);
      userStore = new PostgresUserStore(db);
      recipeStore = new PostgresRecipeStore(db);
      connectionStore = new PostgresConnectionStore(db);
      workspaceStore = new PostgresWorkspaceStore(db);
      workspaces = await workspaceStore.list();

      for (const record of await connectionStore.list()) {
        try {
          sourceConnectors[record.id] = createConnector(record);
        } catch (err: unknown) {
          console.error(`Conexão '${record.id}' ignorada: ${err instanceof Error ? err.message : err}`);
        }
      }

      const compiler = new RecipeCompiler();
      for (const record of await recipeStore.list()) {
        try {
          recipes[record.id] = await compiler.compile(record.id, record.source);
        } catch (err: unknown) {
          failedRecipeIds.push(record.id);
          console.error(`Modelo '${record.id}' ignorado: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    const app = createPlatformApp({
      persistenceStore,
      userStore,
      recipeStore,
      connectionStore,
      workspaceStore,
      workspaces,
      sourceConnectors,
      recipes,
      failedRecipeIds,
    });
    const port = Number(process.env.PORT) || 3000;
    console.log(`🚀 Plataforma Celestia Backend rodando em http://localhost:${port}`);
    serve({ fetch: app.fetch, port });
  })();
}
