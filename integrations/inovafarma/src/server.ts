import type { Context, MiddlewareHandler } from "hono";
import { defineModule, type ModuleDef } from "@platform/core/module";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { INOVAFARMA_EXTERNALS } from "./externals.js";

export { INOVAFARMA_PERMISSIONS, INOVAFARMA_EXTERNALS };

export interface ErpQueryClient {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
  healthCheck?(): Promise<boolean>;
}

export interface InovafarmaPluginDeps {
  /** Middleware de autenticação injetado pelo servidor. */
  auth: MiddlewareHandler;
  /** Clientes de ERP ativos por ID; o InovaFarma utiliza a conexão com id `erpId`. */
  erpClients?: Record<string, ErpQueryClient | undefined>;
  /** ID do ERP configurado no módulo central de ERPs (padrão: "inovafarma"). */
  erpId?: string;
}

/**
 * Plugin InovaFarma: módulo cliente que consome a conexão MSSQL gerenciada pela plataforma
 * e expõe rotas de consulta baseadas nos identificadores externos (codigoColaborador, codigoLoja).
 */
export function createInovafarmaPlugin({ auth, erpClients = {}, erpId = "inovafarma" }: InovafarmaPluginDeps): ModuleDef {
  return defineModule({
    id: "inovafarma",
    version: "1.0.0",
    permissions: INOVAFARMA_PERMISSIONS,
    register({ routes, permissions }) {
      const viewKey = INOVAFARMA_PERMISSIONS.keys["integration:view"];

      routes.get("/status", auth, async (c: Context<{ Variables: { user?: { permissions?: string[] } } }>) => {
        const user = c.get("user");
        if (!permissions.has(user?.permissions, viewKey)) {
          return c.json({ error: INOVAFARMA_PERMISSIONS.items[0]?.deniedMessage ?? "Acesso negado." }, 403);
        }

        const client = erpClients[erpId];
        const isHealthy = client?.healthCheck ? await client.healthCheck() : Boolean(client);

        return c.json({
          module: "inovafarma",
          connected: Boolean(client),
          healthy: isHealthy,
          erpId,
          externals: INOVAFARMA_EXTERNALS,
        });
      });
    },
  });
}
