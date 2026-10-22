import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ErpClientRegistry } from "./erp/erp-client.js";
import { MemoryErpStore, type ErpStore } from "./erp/erp-store.js";
import { createErpClient, type ErpClientFactory } from "./erp/erp-factory.js";
import { createErpModule } from "./erp/erp-module.js";
import { loadModules } from "@platform/core/loader";
import { PermissionRegistry } from "@platform/core/permissions";
import { createIamModule } from "./iam/iam-module.js";
import { AuditLog } from "./audit/audit-log.js";
import { MemoryAuditStore } from "./audit/audit-store.js";
import { createAuditModule } from "./audit/audit-module.js";
import { TokenService } from "./iam/token-service.js";
import { MemoryUserStore, type UserStore } from "./iam/user-store.js";
import { hasPermission } from "./iam/has-permission.js";
import { denyMessage, NON_IAM_PERMISSIONS, SYSTEM_PERMISSION_KEYS } from "./iam/system-permissions.js";
import { createAuthMiddleware } from "./iam/middleware.js";
import type { WorkspaceStore } from "./data/workspace-store.js";
import type { JWTAccessPayload, WorkspaceRecord } from "@platform/shared";

export interface CreatePlatformAppOptions {
  erpClients?: ErpClientRegistry;
  erpStore?: ErpStore;
  clientFactory?: ErpClientFactory;
  userStore?: UserStore;
  tokenService?: TokenService;
  workspaces?: WorkspaceRecord[];
  /** Quando informado, as Áreas de Trabalho são gravadas nele a cada mudança (o Map em memória é só cache). */
  workspaceStore?: WorkspaceStore;
  /** Audit Log do sistema; por padrão, em memória. */
  auditLog?: AuditLog;
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
  const erpClients = options?.erpClients || {};
  const erpStore = options?.erpStore || new MemoryErpStore();
  const clientFactory = options?.clientFactory || createErpClient;
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
  // O Plugin `erp` é carregado no mesmo registro de Permissões, para o catálogo do iam listá-las.
  const moduleApp = new Hono();
  const registry = new PermissionRegistry();
  const modulesReady = (async () => {
    await loadModules(moduleApp, [createIamModule({ userStore, erpStore, extraPermissions: NON_IAM_PERMISSIONS, tokenService, auth, withAdminBypass })], { registry });
    await loadModules(moduleApp, [createErpModule({ erpStore, clients: erpClients, clientFactory, auth })], { registry });
  })();
  for (const path of ["/api/auth/*", "/api/iam/*", "/api/admin/*"]) {
    app.all(path, async (c) => {
      await modulesReady;
      return moduleApp.fetch(c.req.raw);
    });
  }

  // Consulta do Audit Log (/api/audit), servida pelo Module `audit`.
  const auditApp = new Hono();
  const auditLog = options?.auditLog ?? new AuditLog(new MemoryAuditStore());
  const auditReady = loadModules(auditApp, [createAuditModule({ auditLog, auth })]);
  app.all("/api/audit/*", async (c) => {
    await auditReady;
    return auditApp.fetch(c.req.raw);
  });
  app.all("/api/audit", async (c) => {
    await auditReady;
    return auditApp.fetch(c.req.raw);
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
    const erpClients: ErpClientRegistry = {};
    let erpStore: ErpStore | undefined;
    let workspaceStore: WorkspaceStore | undefined;
    let workspaces: WorkspaceRecord[] = [];
    let auditLog: AuditLog | undefined;
    if (process.env.POSTGRES_HOST) {
      const [{ db }, { PostgresUserStore }, { PostgresErpStore }, { PostgresWorkspaceStore }] = await Promise.all([
        import("./db/client.js"),
        import("./iam/postgres-user-store.js"),
        import("./erp/postgres-erp-store.js"),
        import("./data/postgres-workspace-store.js"),
      ]);
      userStore = new PostgresUserStore(db);
      erpStore = new PostgresErpStore(db);
      workspaceStore = new PostgresWorkspaceStore(db);
      const { PostgresAuditStore } = await import("./audit/postgres-audit-store.js");
      auditLog = new AuditLog(new PostgresAuditStore(db));
      workspaces = await workspaceStore.list();

      for (const record of await erpStore.list()) {
        try {
          erpClients[record.id] = createErpClient(record);
        } catch (err: unknown) {
          console.error(`ERP '${record.id}' ignorado: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    const app = createPlatformApp({ userStore, erpStore, workspaceStore, workspaces, erpClients, auditLog });
    const port = Number(process.env.PORT) || 3000;
    console.log(`🚀 Plataforma Celestia Backend rodando em http://localhost:${port}`);
    serve({ fetch: app.fetch, port });
  })();
}
