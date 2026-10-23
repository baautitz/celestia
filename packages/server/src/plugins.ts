import type { MiddlewareHandler } from "hono";
import { createExamplePlugin } from "@integrations/example/server";
import type { ModuleEntry } from "./boot/compose.js";

/**
 * Lista estática de Plugins de /integrations no build (ADR 0003).
 * Para incluir ou tirar um Plugin do build, mexa só aqui (e em packages/web/src/modules.ts para a tela).
 */
export function integrationPlugins({ auth }: { auth: MiddlewareHandler }): ModuleEntry[] {
  return [{ tier: "plugin", def: createExamplePlugin({ auth }) }];
}
