import { randomUUID } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type SourceConnectorRegistry } from "./data/source-connector.js";
import { MemoryConnectionStore, type ConnectionStore } from "./data/connection-store.js";
import type { ConnectionRecord } from "./data/connection-store.js";
import { createConnector, readSecrets, type ConnectorFactory } from "./data/connection-factory.js";
import { ERP_TYPES, parseErpValues } from "./data/erp-types.js";
import { encryptSecret } from "./data/secret-box.js";
import { loadModules } from "@platform/core/loader";
import { createIamModule } from "./iam/iam-module.js";
import { TokenService } from "./iam/token-service.js";
import { MemoryUserStore, type UserStore } from "./iam/user-store.js";
import { PasswordService, PasswordPolicySchema } from "./iam/password-service.js";
import { grantDeniedMessage, missingGrants } from "./iam/can-grant.js";
import { hasPermission } from "./iam/has-permission.js";
import { denyMessage, getSystemPermissionsByModule, SYSTEM_PERMISSION_KEYS } from "./iam/system-permissions.js";
import { createAuthMiddleware, getAuthenticatedUser, requirePermission } from "./iam/middleware.js";
import type { WorkspaceStore } from "./data/workspace-store.js";
import type { JWTAccessPayload, WorkspaceRecord } from "@platform/shared";

export interface CreatePlatformAppOptions {
  sourceConnectors?: SourceConnectorRegistry;
  connectionStore?: ConnectionStore;
  connectorFactory?: ConnectorFactory;
  userStore?: UserStore;
  tokenService?: TokenService;
  workspaces?: WorkspaceRecord[];
  /** Quando informado, as Áreas de Trabalho são gravadas nele a cada mudança (o Map em memória é só cache). */
  workspaceStore?: WorkspaceStore;
}

/** Data civil estrita YYYY-MM-DD (e existente no calendário). */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato YYYY-MM-DD.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "Data inexistente.");

export function createPlatformApp(options?: CreatePlatformAppOptions) {
  const app = new Hono();

  // Middleware CORS para desenvolvimento e produção
  // Allowlist explícita (CORS_ORIGINS, separada por vírgula); nunca reflete uma origem arbitrária.
  const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(
    "*",
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    })
  );
  const sourceConnectors = options?.sourceConnectors || {};
  const connectionStore = options?.connectionStore || new MemoryConnectionStore();
  const connectorFactory = options?.connectorFactory || createConnector;
  const userStore = options?.userStore || new MemoryUserStore();
  const tokenService = options?.tokenService || new TokenService();
  const workspaceStore = options?.workspaceStore;
  const workspacesMap = new Map<string, WorkspaceRecord>((options?.workspaces || []).map((w) => [w.id, w]));

  // Remove das roles as permissões que não existem mais no catálogo do sistema (preserva "*").
  void userStore.syncOrphanPermissions(SYSTEM_PERMISSION_KEYS);

  // Middleware de Autenticação
  // Administrador (isAdmin) ignora a matriz de permissões: recebe todas as permissões válidas no momento da requisição.
  const withAdminBypass = (payload: JWTAccessPayload): JWTAccessPayload =>
    payload.isAdmin
      ? { ...payload, permissions: ["*", ...SYSTEM_PERMISSION_KEYS] }
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

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // Autenticação (/api/auth) é servida pelo Module `iam`, carregado pelo Core num sub-app.
  // O carregamento é assíncrono; a rota aguarda o módulo montar (mount síncrono evita matcher já construído).
  const iamApp = new Hono();
  const iamReady = loadModules(iamApp, [createIamModule({ userStore, tokenService, auth, withAdminBypass })]);
  app.all("/api/auth/*", async (c) => {
    await iamReady;
    return iamApp.fetch(c.req.raw);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. GESTÃO DE USUÁRIOS E ROLES (IAM Permission-First)
  // ─────────────────────────────────────────────────────────────

  // GET /api/iam/permissions/catalog
  app.get("/api/iam/permissions/catalog", auth, requirePermission("system:roles:read"), async (c) => {
    return c.json({ system: getSystemPermissionsByModule() });
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
      // Só admin age sobre admin: nenhum campo de um administrador é alterável por não-admin.
      if (!caller.isAdmin && (await userStore.findById(id))?.isAdmin) {
        const message = body.status === "inactive" ? ADMIN_TARGET_ONLY : "Somente administradores podem alterar outro administrador.";
        return c.json({ error: message }, 403);
      }
      if (body.status === "inactive" && (await isLastActiveAdmin(id))) {
        return c.json({ error: LAST_ADMIN }, 409);
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
    if (id === getAuthenticatedUser(c).sub) {
      return c.json({ error: "Não é possível excluir a si mesmo." }, 409);
    }
    if (!getAuthenticatedUser(c).isAdmin && (await userStore.findById(id))?.isAdmin) {
      return c.json({ error: ADMIN_TARGET_ONLY }, 403);
    }
    if (await isLastActiveAdmin(id)) return c.json({ error: LAST_ADMIN }, 409);
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
    return permissions.filter((p) => p !== "*" && !SYSTEM_PERMISSION_KEYS.has(p));
  }

  // Responde 403 quando o chamador tenta conceder chaves que não possui; devolve undefined se pode.
  const grantViolation = (c: Context, targets: readonly string[]) => {
    const caller = getAuthenticatedUser(c);
    const missing = missingGrants(caller.permissions, targets, caller.isAdmin === true);
    return missing.length > 0 ? c.json({ error: grantDeniedMessage(missing) }, 403) : undefined;
  };

  const LAST_ADMIN = "O sistema precisa de ao menos um administrador ativo.";
  const isLastActiveAdmin = async (id: string): Promise<boolean> => {
    const admins = (await userStore.listUsers()).filter((u) => u.isAdmin && u.status === "active");
    return admins.length === 1 && admins[0].id === id;
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
  // 3. WORKSPACES (Permission-First)
  // ─────────────────────────────────────────────────────────────

  // 1. GET /api/workspaces (Lista todas as Áreas de Trabalho, com filtro opcional por Modelo)
  app.get(
    "/api/workspaces",
    auth,
    guard("system:workspaces:read"),
    (c) => c.json(Array.from(workspacesMap.values()).reverse())
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
          name: z.string().min(1),
          startDate: IsoDateSchema,
          endDate: IsoDateSchema,
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

      const id = `ws_${randomUUID()}`;
      const newWs: WorkspaceRecord = {
        id,
        name: body.name,
        startDate: body.startDate,
        endDate: body.endDate,
        status: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      workspacesMap.set(id, newWs);
      await workspaceStore?.save(newWs);
      return c.json(newWs, 201);
    }
  );

  // 3.1 PUT /api/workspaces/:id (Edição de título e período)
  app.put(
    "/api/workspaces/:id",
    auth,
    guard("system:workspaces:update"),
    zValidator("param", z.object({ id: z.string() })),
    zValidator(
      "json",
      z.object({
        name: z.string().optional(),
        startDate: IsoDateSchema.optional(),
        endDate: IsoDateSchema.optional(),
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
      ws.updatedAt = new Date().toISOString();
      await workspaceStore?.save(ws);

      return c.json(ws);
    }
  );

  // 4. POST /api/workspaces/:id/conclude (Conclui e bloqueia a Área de Trabalho)
  app.post(
    "/api/workspaces/:id/conclude",
    auth,
    guard("system:workspaces:close"),
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
    guard("system:workspaces:reopen"),
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

  return app;
}

export type AppType = ReturnType<typeof createPlatformApp>;

// Inicia servidor se executado diretamente
if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test" && !process.env?.VITEST) {
  void (async () => {
    let userStore: UserStore | undefined;
    const sourceConnectors: SourceConnectorRegistry = {};
    let connectionStore: ConnectionStore | undefined;
    let workspaceStore: WorkspaceStore | undefined;
    let workspaces: WorkspaceRecord[] = [];
    if (process.env.POSTGRES_HOST) {
      const [{ db }, { PostgresUserStore }, { PostgresConnectionStore }, { PostgresWorkspaceStore }] = await Promise.all([
        import("./db/client.js"),
        import("./iam/postgres-user-store.js"),
        import("./data/postgres-connection-store.js"),
        import("./data/postgres-workspace-store.js"),
      ]);
      userStore = new PostgresUserStore(db);
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
    }

    const app = createPlatformApp({ userStore, connectionStore, workspaceStore, workspaces, sourceConnectors });
    const port = Number(process.env.PORT) || 3000;
    console.log(`🚀 Plataforma Celestia Backend rodando em http://localhost:${port}`);
    serve({ fetch: app.fetch, port });
  })();
}
