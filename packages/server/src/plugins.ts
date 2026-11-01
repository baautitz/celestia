import type { MiddlewareHandler } from "hono";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createInovafarmaPlugin, createInovafarmaDriver } from "@integrations/inovafarma/server";
import type { ModuleEntry } from "./boot/compose.js";
import type { ErpClientRegistry } from "./erp/erp-client.js";
import { createMssqlClient, type ErpDriverDef } from "./erp/erp-drivers.js";

export interface IntegrationPluginDeps {
  auth: MiddlewareHandler;
  erpClients?: ErpClientRegistry;
  db?: NodePgDatabase;
}

/**
 * Lista estática de Plugins de /integrations no build (ADR 0003).
 * Para incluir ou tirar um Plugin do build, mexa só aqui (e em packages/web/src/modules.ts para a tela).
 */
export function integrationPlugins({ auth, erpClients, db }: IntegrationPluginDeps): ModuleEntry[] {
  return [
    { tier: "plugin", def: createInovafarmaPlugin({ auth, erpClients, db }) },
  ];
}

/**
 * ERP Drivers declarados pelos Plugins ativos.
 */
export function integrationErpDrivers(): Record<string, ErpDriverDef> {
  return {
    inovafarma: createInovafarmaDriver({ createMssqlClient }),
  };
}
