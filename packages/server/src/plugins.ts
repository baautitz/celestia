import type { MiddlewareHandler } from "hono";
import { createExamplePlugin } from "@integrations/example/server";
import { createInovafarmaPlugin, INOVAFARMA_EXTERNALS } from "@integrations/inovafarma/server";
import type { ModuleEntry } from "./boot/compose.js";
import type { ErpClientRegistry } from "./erp/erp-client.js";
import type { FormFieldDef } from "@platform/shared";

export interface IntegrationPluginDeps {
  auth: MiddlewareHandler;
  erpClients?: ErpClientRegistry;
}

/**
 * Lista estática de Plugins de /integrations no build (ADR 0003).
 * Para incluir ou tirar um Plugin do build, mexa só aqui (e em packages/web/src/modules.ts para a tela).
 */
export function integrationPlugins({ auth, erpClients }: IntegrationPluginDeps): ModuleEntry[] {
  return [
    { tier: "plugin", def: createExamplePlugin({ auth }) },
    { tier: "plugin", def: createInovafarmaPlugin({ auth, erpClients }) },
  ];
}

/**
 * Externals declarados pelos Plugins ativos para cada ERP (por id do ERP).
 */
export function integrationExternalFields(): Record<string, FormFieldDef[]> {
  return {
    inovafarma: INOVAFARMA_EXTERNALS as unknown as FormFieldDef[],
  };
}
