import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { RecipeCompiler } from "./engine/compiler.js";
import { DataResolver } from "./data/data-resolver.js";
import { ActionExecutor } from "./engine/action-executor.js";
import { MockSourceConnector } from "./data/source-connector.js";
import { MemoryPersistenceStore } from "./data/persistence-store.js";
import { TokenService } from "./iam/token-service.js";
import { MemoryUserStore, type UserStore } from "./iam/user-store.js";
import { PasswordService, PasswordPolicySchema } from "./iam/password-service.js";
import { PermissionCatalogEngine } from "./iam/permission-catalog.js";
import { PermissionResolver } from "./iam/permission-resolver.js";
import { createAuthMiddleware, requirePermission } from "./iam/middleware.js";
import type { RecipeDef, ActionDef, JWTAccessPayload, WorkspaceRecord } from "@platform/shared";
import defaultFechamentoRecipe from "./recipes/default-recipe.js";

export interface CreatePlatformAppOptions {
  compiler?: RecipeCompiler;
  sourceConnector?: MockSourceConnector;
  persistenceStore?: MemoryPersistenceStore;
  userStore?: UserStore;
  tokenService?: TokenService;
  recipes?: Record<string, RecipeDef>;
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
  const sourceConnector = options?.sourceConnector || new MockSourceConnector();
  const persistenceStore = options?.persistenceStore || new MemoryPersistenceStore();
  const userStore = options?.userStore || new MemoryUserStore();
  const tokenService = options?.tokenService || new TokenService();
  const recipesMap = new Map<string, RecipeDef>(Object.entries(options?.recipes || {}));
  const workspacesMap = new Map<string, WorkspaceRecord>();

  // Seeds de Áreas de Trabalho padrão
  workspacesMap.set("ws_fechamento_jan_2026", {
    id: "ws_fechamento_jan_2026",
    recipeId: "fechamento_mes",
    name: "Fechamento Mensal — Janeiro / 2026",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    status: "open",
    createdAt: "2026-02-01T08:00:00Z",
    updatedAt: "2026-02-01T08:00:00Z",
  });
  workspacesMap.set("ws_fechamento_dez_2025", {
    id: "ws_fechamento_dez_2025",
    recipeId: "fechamento_mes",
    name: "Fechamento Mensal — Dezembro / 2025",
    startDate: "2025-12-01",
    endDate: "2025-12-31",
    status: "closed",
    createdAt: "2026-01-02T09:30:00Z",
    updatedAt: "2026-01-02T09:30:00Z",
  });

  // Sincroniza e limpa permissões órfãs das roles na inicialização
  userStore.syncOrphanPermissions(Object.fromEntries(recipesMap));

  // Middleware de Autenticação
  const auth = createAuthMiddleware(tokenService);

  // Helper opcional para extrair usuário sem forçar 401
  const optionalAuthMiddleware = async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const payload = await tokenService.verifyAccessToken(authHeader.substring(7));
        c.set("user", payload);
      } catch {
        // Ignora erro em auth opcional
      }
    }
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
        user: payload,
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
          user: userPayload,
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
      })
    ),
    async (c) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      try {
        const updated = await userStore.updateUser(id, body);
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

      const invalid = validatePermissionKeys(body.permissions);
      if (invalid.length > 0) {
        return c.json({ error: `Permissões inválidas: ${invalid.join(", ")}` }, 400);
      }

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

      if (body.permissions) {
        const invalid = validatePermissionKeys(body.permissions);
        if (invalid.length > 0) {
          return c.json({ error: `Permissões inválidas: ${invalid.join(", ")}` }, 400);
        }
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
  // 3. WORKSPACES & SDUI CORE ROUTES (Permission-First)
  // ─────────────────────────────────────────────────────────────

  // 1. GET /api/workspaces (Lista todas as Áreas de Trabalho, com filtro opcional por Modelo)
  app.get(
    "/api/workspaces",
    optionalAuthMiddleware,
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
    optionalAuthMiddleware,
    zValidator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const ws = workspacesMap.get(id);
      if (ws) return c.json(ws);

      return c.json({
        id,
        recipeId: "fechamento_mes",
        name: `Área de Trabalho ${id}`,
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        status: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  );

  // 3. POST /api/workspaces (Criação de nova Área de Trabalho com datas obrigatórias)
  app.post(
    "/api/workspaces",
    optionalAuthMiddleware,
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
      const user = c.get("user") as JWTAccessPayload | undefined;

      if (user && user.permissions && !user.permissions.includes("system:workspaces:create")) {
        return c.json(
          { error: "Acesso negado: o usuário não possui permissão para criar Áreas de Trabalho." },
          403
        );
      }

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
      return c.json(newWs, 201);
    }
  );

  // 3.1 PUT /api/workspaces/:id (Edição de título, período e parâmetros)
  app.put(
    "/api/workspaces/:id",
    optionalAuthMiddleware,
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
      const user = c.get("user") as JWTAccessPayload | undefined;

      if (user && user.permissions && !user.permissions.includes("system:workspaces:update")) {
        return c.json(
          { error: "Acesso negado: o usuário não possui permissão para editar Áreas de Trabalho." },
          403
        );
      }

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

      return c.json(ws);
    }
  );

  // 4. POST /api/workspaces/:id/conclude (Conclui e bloqueia a Área de Trabalho)
  app.post(
    "/api/workspaces/:id/conclude",
    optionalAuthMiddleware,
    zValidator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const user = c.get("user") as JWTAccessPayload | undefined;

      if (
        user &&
        user.permissions &&
        !user.permissions.includes("system:workspaces:close") &&
        !user.permissions.includes("system:workspaces:create")
      ) {
        return c.json(
          { error: "Acesso negado: o usuário não possui permissão para concluir Áreas de Trabalho." },
          403
        );
      }

      let ws = workspacesMap.get(id);
      if (!ws) {
        ws = {
          id,
          recipeId: "fechamento_mes",
          name: `Área de Trabalho ${id}`,
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          status: "closed" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        workspacesMap.set(id, ws);
      } else {
        ws.status = "closed";
        ws.updatedAt = new Date().toISOString();
      }

      return c.json({ success: true, workspace: ws });
    }
  );

  // 5. POST /api/workspaces/:id/reopen (Reabre a Área de Trabalho concluída)
  app.post(
    "/api/workspaces/:id/reopen",
    optionalAuthMiddleware,
    zValidator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const user = c.get("user") as JWTAccessPayload | undefined;

      if (
        user &&
        user.permissions &&
        !user.permissions.includes("system:workspaces:reopen") &&
        !user.permissions.includes("system:workspaces:create")
      ) {
        return c.json(
          { error: "Acesso negado: o usuário não possui permissão para reabrir Áreas de Trabalho (system:workspaces:reopen)." },
          403
        );
      }

      let ws = workspacesMap.get(id);
      if (!ws) {
        ws = {
          id,
          recipeId: "fechamento_mes",
          name: `Área de Trabalho ${id}`,
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          status: "open" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        workspacesMap.set(id, ws);
      } else {
        ws.status = "open";
        ws.updatedAt = new Date().toISOString();
      }

      return c.json({ success: true, workspace: ws });
    }
  );

  // 5.1 DELETE /api/workspaces/:id (Exclui Área de Trabalho — permission-first)
  app.delete(
    "/api/workspaces/:id",
    optionalAuthMiddleware,
    zValidator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const user = c.get("user") as JWTAccessPayload | undefined;

      if (user && user.permissions && !user.permissions.includes("system:workspaces:delete")) {
        return c.json(
          { error: "Acesso negado: o usuário não possui permissão para excluir Áreas de Trabalho (system:workspaces:delete)." },
          403
        );
      }

      const ws = workspacesMap.get(id);
      if (!ws) {
        return c.json({ error: "Área de Trabalho não encontrada." }, 404);
      }

      workspacesMap.delete(id);
      return c.json({ success: true });
    }
  );

  // 5.1 GET /api/recipes (Catálogo de Modelos disponíveis, filtrado por permissão de visualização)
  app.get("/api/recipes", optionalAuthMiddleware, async (c) => {
    const user = c.get("user") as JWTAccessPayload | undefined;

    let catalog = Array.from(recipesMap.values()).map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      description: recipe.description,
    }));

    if (user && user.permissions && user.permissions.length > 0) {
      catalog = catalog.filter((item) => user.permissions!.includes(`recipe:${item.id}:view`));
    }

    return c.json(catalog);
  });

  // 5.2 GET /api/lookups (Opções de um campo com lookup definido no Modelo)
  app.get(
    "/api/lookups",
    optionalAuthMiddleware,
    zValidator("query", z.object({ recipe_id: z.string(), field: z.string() })),
    async (c) => {
      const { recipe_id, field } = c.req.valid("query");
      const user = c.get("user") as JWTAccessPayload | undefined;

      if (user && user.permissions && !user.permissions.includes(`recipe:${recipe_id}:view`)) {
        return c.json({ error: "Acesso negado: o usuário não possui permissão para visualizar este Modelo." }, 403);
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
        const rows = await sourceConnector.query(fieldDef.lookup.query);
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
    optionalAuthMiddleware,
    zValidator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const recipe = getRecipe(id);
      const user = c.get("user") as JWTAccessPayload | undefined;

      // Filtra actions pelas permissões do usuário se logado
      let filteredActions = recipe.actions;
      if (user && user.permissions) {
        filteredActions = recipe.actions.filter((a: ActionDef) =>
          PermissionResolver.canExecuteAction({
            recipeId: recipe.id,
            actionDef: a,
            userPermissions: user.permissions,
          })
        );
      }

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
        ui: recipe.ui,
      };

      return c.json(uiSchema);
    }
  );

  // 2. GET /api/workspaces/:id/data/:componentId (Retorna dados do componente resolvidos com IAM)
  app.get(
    "/api/workspaces/:id/data/:componentId",
    optionalAuthMiddleware,
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
      const recipe = getRecipe(query.recipe_id);
      const user = c.get("user") as JWTAccessPayload | undefined;

      try {
        const result = await DataResolver.resolveComponentData({
          recipe,
          workspaceId,
          componentId,
          sourceConnector,
          persistenceStore,
          context: {
            workspace: {
              startDate: query.start_date,
              endDate: query.end_date,
              params: workspacesMap.get(workspaceId)?.params,
            },
            user: user
              ? {
                  id: user.sub,
                  role: user.role,
                  permissions: user.permissions,
                  externals: user.externals,
                }
              : undefined,
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
    optionalAuthMiddleware,
    zValidator("param", z.object({ id: z.string() })),
    zValidator(
      "json",
      z.object({
        recipe_id: z.string().default("fechamento_mes"),
        action_id: z.string(),
        row: z.record(z.unknown()),
        form_data: z.record(z.unknown()).optional(),
        workspace_version: z.number().default(1),
      })
    ),
    async (c) => {
      const { id: workspaceId } = c.req.valid("param");
      const body = c.req.valid("json");
      const recipe = getRecipe(body.recipe_id);
      const user = c.get("user") as JWTAccessPayload | undefined;

      // Trava de execução se a Área de Trabalho estiver concluída para ações de modificação
      const ws = workspacesMap.get(workspaceId);
      const actionDef = recipe.actions.find((a: ActionDef) => a.id === body.action_id);
      const isMutation = actionDef?.nature !== "read";

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
          row: body.row,
          formData: body.form_data,
          workspaceId,
          workspaceVersion: body.workspace_version,
          persistenceStore,
          userPermissions: user?.permissions,
        });

        return c.json(result);
      } catch (err: unknown) {
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
      if (ws && ws.status === "closed") {
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
    zValidator("param", z.object({ id: z.string(), collection: z.string(), foreignKeyValue: z.string() })),
    async (c) => {
      const { id: workspaceId, collection, foreignKeyValue } = c.req.valid("param");
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
  const sourceConnector = new MockSourceConnector({
    default: [
      { vendedor_id: 1, vendedor: "Carlos Vendedor", venda_geral: 10000 },
      { vendedor_id: 42, vendedor: "João da Silva", venda_geral: 25000 },
      { vendedor_id: 99, vendedor: "Maria Souza", venda_geral: 15000 },
    ],
    categories: [
      { value: 1, label: "Higiene Pessoal" },
      { value: 2, label: "Medicamentos" },
      { value: 3, label: "Vitaminas e Suplementos" },
      { value: 4, label: "Dermocosméticos" },
      { value: 5, label: "Equipamentos Médicos" },
    ],
  });

  const app = createPlatformApp({
    sourceConnector,
    recipes: {
      fechamento_mes: defaultFechamentoRecipe,
    },
  });
  const port = Number(process.env.PORT) || 3000;
  console.log(`🚀 Plataforma Celestia Backend rodando em http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}
