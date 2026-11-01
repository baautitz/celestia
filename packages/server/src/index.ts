import { Hono } from "hono";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { assertEncryptionKey } from "./erp/secret-box.js";
import type { ErpClientRegistry } from "./erp/erp-client.js";
import { MemoryErpStore, type ErpStore } from "./erp/erp-store.js";
import { createErpClientFactory, type ErpClientFactory } from "./erp/erp-factory.js";
import { ERP_DRIVERS } from "./erp/erp-drivers.js";
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
import { unavailableCertificateAuthority, type CertificateAuthorityClient } from "./iam/certificate-authority-client.js";
import { loadCertificateAuthorityClient } from "./boot/certificate-authority.js";
import { serveWebApp } from "./boot/web-app.js";
import { NON_IAM_PERMISSIONS, SYSTEM_PERMISSION_KEYS } from "./iam/system-permissions.js";
import { createAuthMiddleware } from "./iam/middleware.js";
import { integrationPlugins, integrationErpDrivers } from "./plugins.js";
import { createClosingPeriodModule } from "./closing-period/closing-period-module.js";
import { MemoryClosingPeriodStore, type ClosingPeriodStore } from "./closing-period/closing-period-store.js";
import type { JWTAccessPayload } from "@platform/shared";

export interface CreatePlatformAppOptions {
  erpClients?: ErpClientRegistry;
  erpStore?: ErpStore;
  clientFactory?: ErpClientFactory;
  userStore?: UserStore;
  /** Autoridade certificadora dos Dispositivos. Sem ela, quem exige certificado não entra (falha fechado). */
  certificateAuthority?: CertificateAuthorityClient;
  tokenService?: TokenService;
  closingPeriodStore?: ClosingPeriodStore;
  /** Audit Log do sistema; por padrão, em memória. */
  auditLog?: AuditLog;
  /** Postgres entregue aos Plugins, que não importam o servidor; sem ele, guardam em memória. */
  db?: NodePgDatabase;
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
  const extraDrivers = integrationErpDrivers();
  const allDrivers = { ...ERP_DRIVERS, ...extraDrivers };
  const clientFactory = options?.clientFactory || createErpClientFactory(allDrivers);
  const userStore = options?.userStore || new MemoryUserStore();
  const certificateAuthority = options?.certificateAuthority ?? unavailableCertificateAuthority;
  const tokenService = options?.tokenService || new TokenService();
  const closingPeriodStore = options?.closingPeriodStore || new MemoryClosingPeriodStore();

  // Registro de Permissions preenchido pelo Core ao carregar os Modules (inclui Plugins extras).
  const registry = new PermissionRegistry();

  // Middleware de Autenticação
  // Administrador (isAdmin) ignora a matriz de permissões: recebe todas as permissões do registro no momento da requisição.
  const withAdminBypass = (payload: JWTAccessPayload): JWTAccessPayload =>
    payload.isAdmin
      ? { ...payload, permissions: ["*", ...registry.allKeys()] }
      : payload;

  const auth = createAuthMiddleware(tokenService, withAdminBypass);

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // Os Modules são carregados pelo Core num sub-app; as rotas aguardam o carregamento (mount síncrono evita matcher já construído).
  // Base System: iam e audit. Plugins: closing_period e erp (ADR 0003). Todos compartilham o registro de Permissions.
  const auditLog = options?.auditLog ?? new AuditLog(new MemoryAuditStore());
  const entries: ModuleEntry[] = [
    { tier: "base", def: createIamModule({ userStore, certificateAuthority, auditLog, extraPermissions: NON_IAM_PERMISSIONS, tokenService, auth, withAdminBypass, loginRateLimiter: options?.loginRateLimiter }) },
    { tier: "base", def: createAuditModule({ auditLog, auth }) },
    { tier: "plugin", def: createClosingPeriodModule({ store: closingPeriodStore, auditLog, auth }) },
    {
      tier: "plugin",
      def: createErpModule({
        erpStore,
        clients: erpClients,
        clientFactory,
        auth,
        extraDrivers,
      }),
    },
    ...integrationPlugins({ auth, erpClients, db: options?.db }),
    ...(options?.extraModules ?? []),
  ];
  const moduleApp = new Hono();
  let started: Promise<unknown> | undefined;
  // Remove das roles as permissões fora do catálogo, só se todos os Modules carregaram (o Core decide via pruneSafe).
  const start = (): Promise<unknown> =>
    (started ??= composeModules(moduleApp, entries, {
      registry,
      logger: console,
      prune: (keys) => userStore.syncOrphanPermissions(new Set([...keys, ...SYSTEM_PERMISSION_KEYS])),
    }));
  // O encaminhamento segue os prefixos dos Modules (o mesmo cálculo do loader: `prefix` ou `/api/m/<id>`).
  const mounts = entries.map(({ def }) => (def.prefix ?? `/api/m/${def.id}`).replace(/\/+$/, ""));
  for (const mount of new Set(mounts)) {
    for (const path of mount === "" ? ["/*"] : [mount, `${mount}/*`]) {
      app.all(path, async (c) => {
        await start();
        return moduleApp.fetch(c.req.raw, c.env);
      });
    }
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
const isMain =
  typeof process !== "undefined" &&
  Boolean(process.argv[1] && (process.argv[1].endsWith("/index.ts") || process.argv[1].endsWith("/index.js")));

if (isMain && process.env?.NODE_ENV !== "test" && !process.env?.VITEST) {
  void (async () => {
    // Falha antes de qualquer outra coisa: sem a chave em comum com a CA (e, em produção, o endereço dela) o servidor não sobe.
    const certificateAuthority = loadCertificateAuthorityClient();
    assertEncryptionKey();
    let userStore: UserStore | undefined;
    const erpClients: ErpClientRegistry = {};
    let erpStore: ErpStore | undefined;
    let closingPeriodStore: ClosingPeriodStore | undefined;
    let auditLog: AuditLog | undefined;
    let pluginDb: NodePgDatabase | undefined;
    if (process.env.POSTGRES_HOST) {
      const [{ db }, { PostgresUserStore }, { PostgresErpStore }, { PostgresClosingPeriodStore }] = await Promise.all([
        import("./db/client.js"),
        import("./iam/postgres-user-store.js"),
        import("./erp/postgres-erp-store.js"),
        import("./closing-period/postgres-closing-period-store.js"),
      ]);
      pluginDb = db;
      userStore = new PostgresUserStore(db);
      erpStore = new PostgresErpStore(db);
      closingPeriodStore = new PostgresClosingPeriodStore(db);
      const { PostgresAuditStore } = await import("./audit/postgres-audit-store.js");
      auditLog = new AuditLog(new PostgresAuditStore(db));

      const bootClientFactory = createErpClientFactory({ ...ERP_DRIVERS, ...integrationErpDrivers() });
      for (const record of await erpStore.list()) {
        try {
          erpClients[record.id] = bootClientFactory(record);
        } catch (err: unknown) {
          console.error(`ERP '${record.id}' ignorado: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    const platform = createPlatform({
      userStore,
      certificateAuthority,
      erpStore, closingPeriodStore,
      erpClients,
      auditLog,
      db: pluginDb,
    });
    if (process.env.POSTGRES_HOST) {
      // Verifica (sem aplicar) que as migrations dos Modules estão em dia; a mensagem nomeia o Module.
      const { db } = await import("./db/client.js");
      await assertMigrationsUpToDate(db, migrationPlan(platform.modules));
    }
    await platform.start(); // falha de Module do Base System derruba o boot
    const app = platform.app;
    if (process.env.WEB_ROOT) serveWebApp(app, process.env.WEB_ROOT);
    const port = Number(process.env.PORT) || 3000;
    console.log(`🚀 Plataforma Celestia Backend rodando em http://localhost:${port}`);
    serve({ fetch: app.fetch, port });
  })();
}
