import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { ErpClientRegistry } from "./erp/erp-client.js";
import { MemoryErpStore, type ErpStore } from "./erp/erp-store.js";
import { MemoryErpExternalsStore, type ErpExternalsStore } from "./erp/erp-externals-store.js";
import { createErpClient, type ErpClientFactory } from "./erp/erp-factory.js";
import { createErpModule } from "./erp/erp-module.js";
import { composeModules, migrationPlan, type ModuleEntry } from "./boot/compose.js";
import { assertMigrationsUpToDate } from "@platform/core/migrations";
import { PermissionRegistry } from "@platform/core/permissions";
import { LoginRateLimiter } from "./iam/login-rate-limiter.js";
import { createIamModule } from "./iam/iam-module.js";
import { AuditLog } from "./audit/audit-log.js";
import { MemoryAuditStore } from "./audit/audit-store.js";
import { createAuditModule } from "./audit/audit-module.js";
import { TokenService } from "./iam/token-service.js";
import { MemoryUserStore, type UserStore } from "./iam/user-store.js";
import { NON_IAM_PERMISSIONS, SYSTEM_PERMISSION_KEYS } from "./iam/system-permissions.js";
import { createAuthMiddleware } from "./iam/middleware.js";
import { integrationPlugins } from "./plugins.js";
import { createClosingPeriodModule } from "./closing-period/closing-period-module.js";
import { CLOSING_PERIOD_PERMISSIONS } from "./closing-period/closing-period-permissions.js";
import { MemoryClosingPeriodStore, type ClosingPeriodStore } from "./closing-period/closing-period-store.js";
import type { JWTAccessPayload } from "@platform/shared";

export interface CreatePlatformAppOptions {
  erpClients?: ErpClientRegistry;
  erpStore?: ErpStore;
  erpExternalsStore?: ErpExternalsStore;
  clientFactory?: ErpClientFactory;
  userStore?: UserStore;
  tokenService?: TokenService;
  closingPeriodStore?: ClosingPeriodStore;
  /** Audit Log do sistema; por padrão, em memória. */
  auditLog?: AuditLog;
  /** Modules adicionais compostos junto aos padrão (testes e builds de cliente). */
  extraModules?: ModuleEntry[];
  /** Limite de tentativas de login (injetável em testes). */
  loginRateLimiter?: LoginRateLimiter;
}

export function createPlatform(options?: CreatePlatformAppOptions) {
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
  const erpExternalsStore = options?.erpExternalsStore || new MemoryErpExternalsStore();
  const clientFactory = options?.clientFactory || createErpClient;
  const userStore = options?.userStore || new MemoryUserStore();
  const tokenService = options?.tokenService || new TokenService();
  const closingPeriodStore = options?.closingPeriodStore || new MemoryClosingPeriodStore();

  const validKeys: ReadonlySet<string> = new Set([...SYSTEM_PERMISSION_KEYS, ...CLOSING_PERIOD_PERMISSIONS.items.map((p) => p.key)]);

  // Middleware de Autenticação
  // Administrador (isAdmin) ignora a matriz de permissões: recebe todas as permissões válidas no momento da requisição.
  const withAdminBypass = (payload: JWTAccessPayload): JWTAccessPayload =>
    payload.isAdmin
      ? { ...payload, permissions: ["*", ...validKeys] }
      : payload;

  const auth = createAuthMiddleware(tokenService, withAdminBypass);

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // Os Modules são carregados pelo Core num sub-app; as rotas aguardam o carregamento (mount síncrono evita matcher já construído).
  // Base System: iam e audit. Plugins: closing_period e erp (ADR 0003). Todos compartilham o registro de Permissions.
  const auditLog = options?.auditLog ?? new AuditLog(new MemoryAuditStore());
  const entries: ModuleEntry[] = [
    { tier: "base", def: createIamModule({ userStore, extraPermissions: NON_IAM_PERMISSIONS, tokenService, auth, withAdminBypass, loginRateLimiter: options?.loginRateLimiter }) },
    { tier: "base", def: createAuditModule({ auditLog, auth }) },
    { tier: "plugin", def: createClosingPeriodModule({ store: closingPeriodStore, auth }) },
    { tier: "plugin", def: createErpModule({ erpStore, externalsStore: erpExternalsStore, clients: erpClients, clientFactory, auth }) },
    ...integrationPlugins({ auth }),
    ...(options?.extraModules ?? []),
  ];
  const moduleApp = new Hono();
  const registry = new PermissionRegistry();
  let started: Promise<unknown> | undefined;
  // Remove das roles as permissões fora do catálogo, só se todos os Modules carregaram (o Core decide via pruneSafe).
  const start = (): Promise<unknown> =>
    (started ??= composeModules(moduleApp, entries, {
      registry,
      logger: console,
      prune: (keys) => userStore.syncOrphanPermissions(new Set([...keys, ...SYSTEM_PERMISSION_KEYS])),
    }));
  for (const path of ["/api/auth/*", "/api/iam/*", "/api/admin/*", "/api/closing-periods", "/api/closing-periods/*", "/api/audit", "/api/audit/*", "/api/m/*"]) {
    app.all(path, async (c) => {
      await start();
      return moduleApp.fetch(c.req.raw, c.env);
    });
  }

  return { app, start, modules: entries.map((e) => e.def) };
}

export function createPlatformApp(options?: CreatePlatformAppOptions) {
  const platform = createPlatform(options);
  // Falha de Module do Base System: as rotas dos Modules respondem 500; quem precisa abortar o boot usa createPlatform().start().
  void platform.start().catch((err: unknown) => console.error(err instanceof Error ? err.message : err));
  return platform.app;
}

export type AppType = ReturnType<typeof createPlatformApp>;

// Inicia servidor se executado diretamente
if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test" && !process.env?.VITEST) {
  void (async () => {
    let userStore: UserStore | undefined;
    const erpClients: ErpClientRegistry = {};
    let erpStore: ErpStore | undefined;
    let erpExternalsStore: ErpExternalsStore | undefined;
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
      const { PostgresErpExternalsStore } = await import("./erp/postgres-erp-externals-store.js");
      erpExternalsStore = new PostgresErpExternalsStore(db);
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

    const platform = createPlatform({ userStore, erpStore, erpExternalsStore, closingPeriodStore, erpClients, auditLog });
    if (process.env.POSTGRES_HOST) {
      // Verifica (sem aplicar) que as migrations dos Modules estão em dia; a mensagem nomeia o Module.
      const { db } = await import("./db/client.js");
      await assertMigrationsUpToDate(db, migrationPlan(platform.modules));
    }
    await platform.start(); // falha de Module do Base System derruba o boot
    const app = platform.app;
    const port = Number(process.env.PORT) || 3000;
    console.log(`🚀 Plataforma Celestia Backend rodando em http://localhost:${port}`);
    serve({ fetch: app.fetch, port });
  })();
}
