import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
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
import { NON_IAM_PERMISSIONS, SYSTEM_PERMISSION_KEYS } from "./iam/system-permissions.js";
import { createAuthMiddleware } from "./iam/middleware.js";
import { createClosingPeriodModule } from "./closing-period/closing-period-module.js";
import { CLOSING_PERIOD_PERMISSIONS } from "./closing-period/closing-period-permissions.js";
import { MemoryClosingPeriodStore, type ClosingPeriodStore } from "./closing-period/closing-period-store.js";
import type { JWTAccessPayload } from "@platform/shared";

export interface CreatePlatformAppOptions {
  erpClients?: ErpClientRegistry;
  erpStore?: ErpStore;
  clientFactory?: ErpClientFactory;
  userStore?: UserStore;
  tokenService?: TokenService;
  closingPeriodStore?: ClosingPeriodStore;
  /** Audit Log do sistema; por padrão, em memória. */
  auditLog?: AuditLog;
}

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
  const closingPeriodStore = options?.closingPeriodStore || new MemoryClosingPeriodStore();

  // Remove das roles as permissões que não existem mais no catálogo do sistema (preserva "*").
  const validKeys: ReadonlySet<string> = new Set([...SYSTEM_PERMISSION_KEYS, ...CLOSING_PERIOD_PERMISSIONS.items.map((p) => p.key)]);
  void userStore.syncOrphanPermissions(validKeys);

  // Middleware de Autenticação
  // Administrador (isAdmin) ignora a matriz de permissões: recebe todas as permissões válidas no momento da requisição.
  const withAdminBypass = (payload: JWTAccessPayload): JWTAccessPayload =>
    payload.isAdmin
      ? { ...payload, permissions: ["*", ...validKeys] }
      : payload;

  const auth = createAuthMiddleware(tokenService, withAdminBypass);

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // Autenticação (/api/auth) é servida pelo Module `iam`, carregado pelo Core num sub-app.
  // O carregamento é assíncrono; a rota aguarda o módulo montar (mount síncrono evita matcher já construído).
  // Os Plugins `closing_period` e `erp` são carregados no mesmo registro de Permissões, para o catálogo do iam listá-las.
  const moduleApp = new Hono();
  const registry = new PermissionRegistry();
  const modulesReady = (async () => {
    await loadModules(
      moduleApp,
      [
        createIamModule({ userStore, erpStore, extraPermissions: NON_IAM_PERMISSIONS, tokenService, auth, withAdminBypass }),
        createClosingPeriodModule({ store: closingPeriodStore, auth }),
      ],
      { registry },
    );
    await loadModules(moduleApp, [createErpModule({ erpStore, clients: erpClients, clientFactory, auth })], { registry });
  })();
  for (const path of ["/api/auth/*", "/api/iam/*", "/api/admin/*", "/api/closing-periods", "/api/closing-periods/*"]) {
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

  return app;
}

export type AppType = ReturnType<typeof createPlatformApp>;

// Inicia servidor se executado diretamente
if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test" && !process.env?.VITEST) {
  void (async () => {
    let userStore: UserStore | undefined;
    const erpClients: ErpClientRegistry = {};
    let erpStore: ErpStore | undefined;
    let closingPeriodStore: ClosingPeriodStore | undefined;
    let auditLog: AuditLog | undefined;
    if (process.env.POSTGRES_HOST) {
      const [{ db }, { PostgresUserStore }, { PostgresErpStore }, { PostgresClosingPeriodStore }] = await Promise.all([
        import("./db/client.js"),
        import("./iam/postgres-user-store.js"),
        import("./erp/postgres-erp-store.js"),
        import("./closing-period/postgres-closing-period-store.js"),
      ]);
      userStore = new PostgresUserStore(db);
      erpStore = new PostgresErpStore(db);
      closingPeriodStore = new PostgresClosingPeriodStore(db);
      const { PostgresAuditStore } = await import("./audit/postgres-audit-store.js");
      auditLog = new AuditLog(new PostgresAuditStore(db));

      for (const record of await erpStore.list()) {
        try {
          erpClients[record.id] = createErpClient(record);
        } catch (err: unknown) {
          console.error(`ERP '${record.id}' ignorado: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    const app = createPlatformApp({ userStore, erpStore, closingPeriodStore, erpClients, auditLog });
    const port = Number(process.env.PORT) || 3000;
    console.log(`🚀 Plataforma Celestia Backend rodando em http://localhost:${port}`);
    serve({ fetch: app.fetch, port });
  })();
}
