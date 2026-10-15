import type { Hono } from "hono";
import type { EventBus, EventHandlerOptions, BeforeHandler, AfterHandler } from "./events.js";
import type { ModulePermissions, PermissionItem } from "./permissions.js";

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export type EventMap = Record<string, object>;

export interface ScopedEvents {
  on(event: string, handler: BeforeHandler<object> | AfterHandler<object>, options?: EventHandlerOptions): () => void;
  before(event: string, handler: BeforeHandler<object>, options?: Omit<EventHandlerOptions, "phase">): () => void;
  after(event: string, handler: AfterHandler<object>, options?: Omit<EventHandlerOptions, "phase">): () => void;
  run: EventBus<EventMap>["run"];
}

export interface ModuleContext {
  moduleId: string;
  /** Sub-app relativo; montado em /api/m/<id>. */
  routes: Hono;
  events: ScopedEvents;
  permissions: {
    registerProvider(provider: () => PermissionItem[]): void;
    has(userPermissions: readonly string[] | undefined, key: string): boolean;
  };
  services: {
    expose<T>(name: string, impl: T): void;
    use<T>(moduleId: string, name: string): T;
  };
  logger: Logger;
}

export interface ModuleDef {
  id: string;
  version: string;
  dependsOn?: string[];
  permissions?: ModulePermissions;
  migrations?: { folder: string; schema?: string };
  register(ctx: ModuleContext): void | Promise<void>;
}

const ID = /^[a-z][a-z0-9_]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function defineModule(def: ModuleDef): ModuleDef {
  if (typeof def.id !== "string" || !ID.test(def.id)) {
    throw new Error(`Id de módulo inválido "${String(def.id)}": use apenas [a-z][a-z0-9_]*.`);
  }
  if (typeof def.version !== "string" || !SEMVER.test(def.version)) {
    throw new Error(`Versão inválida "${String(def.version)}" no módulo "${def.id}": use o formato semver (ex.: 1.0.0).`);
  }
  if (def.dependsOn?.includes(def.id)) {
    throw new Error(`O módulo "${def.id}" não pode depender de si mesmo.`);
  }
  if (typeof def.register !== "function") {
    throw new Error(`O módulo "${def.id}" deve declarar register(ctx).`);
  }
  return def;
}
