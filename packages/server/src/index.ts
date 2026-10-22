import { Hono } from "hono";
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
import { AuditLog } from "./audit/audit-log.js";
import { MemoryAuditStore } from "./audit/audit-store.js";
import { createAuditModule } from "./audit/audit-module.js";
import { TokenService } from "./iam/token-service.js";
import { MemoryUserStore, type UserStore } from "./iam/user-store.js";
import { NON_IAM_PERMISSIONS, SYSTEM_PERMISSION_KEYS } from "./iam/system-permissions.js";
import { createAuthMiddleware, requirePermission } from "./iam/middleware.js";
import { createClosingPeriodModule } from "./closing-period/closing-period-module.js";
import { CLOSING_PERIOD_PERMISSIONS } from "./closing-period/closing-period-permissions.js";
import { MemoryClosingPeriodStore, type ClosingPeriodStore } from "./closing-period/closing-period-store.js";
import type { JWTAccessPayload } from "@platform/shared";

export interface CreatePlatformAppOptions {
  sourceConnectors?: SourceConnectorRegistry;
  connectionStore?: ConnectionStore;
  connectorFactory?: ConnectorFactory;
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
  const sourceConnectors = options?.sourceConnectors || {};
  const connectionStore = options?.connectionStore || new MemoryConnectionStore();
  const connectorFactory = options?.connectorFactory || createConnector;
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
  const iamApp = new Hono();
  // O Plugin `closing_period` é carregado junto, para o catálogo de Permissions agregar as chaves de ambos.
  const iamReady = loadModules(iamApp, [
    createIamModule({ userStore, connectionStore, extraPermissions: NON_IAM_PERMISSIONS, tokenService, auth, withAdminBypass }),
    createClosingPeriodModule({ store: closingPeriodStore, auth }),
  ]);
  for (const path of ["/api/auth/*", "/api/iam/*", "/api/closing-periods", "/api/closing-periods/*"]) {
    app.all(path, async (c) => {
      await iamReady;
      return iamApp.fetch(c.req.raw);
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

  return app;
}

export type AppType = ReturnType<typeof createPlatformApp>;

// Inicia servidor se executado diretamente
if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test" && !process.env?.VITEST) {
  void (async () => {
    let userStore: UserStore | undefined;
    const sourceConnectors: SourceConnectorRegistry = {};
    let connectionStore: ConnectionStore | undefined;
    let closingPeriodStore: ClosingPeriodStore | undefined;
    let auditLog: AuditLog | undefined;
    if (process.env.POSTGRES_HOST) {
      const [{ db }, { PostgresUserStore }, { PostgresConnectionStore }, { PostgresClosingPeriodStore }] = await Promise.all([
        import("./db/client.js"),
        import("./iam/postgres-user-store.js"),
        import("./data/postgres-connection-store.js"),
        import("./closing-period/postgres-closing-period-store.js"),
      ]);
      userStore = new PostgresUserStore(db);
      connectionStore = new PostgresConnectionStore(db);
      closingPeriodStore = new PostgresClosingPeriodStore(db);
      const { PostgresAuditStore } = await import("./audit/postgres-audit-store.js");
      auditLog = new AuditLog(new PostgresAuditStore(db));

      for (const record of await connectionStore.list()) {
        try {
          sourceConnectors[record.id] = createConnector(record);
        } catch (err: unknown) {
          console.error(`Conexão '${record.id}' ignorada: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    const app = createPlatformApp({ userStore, connectionStore, closingPeriodStore, sourceConnectors, auditLog });
    const port = Number(process.env.PORT) || 3000;
    console.log(`🚀 Plataforma Celestia Backend rodando em http://localhost:${port}`);
    serve({ fetch: app.fetch, port });
  })();
}
