import { Hono, type MiddlewareHandler } from "hono";
import { EventBus } from "./events.js";
import { topoSort } from "./graph.js";
import { PermissionRegistry, type PermissionItem } from "./permissions.js";
import type { EventMap, Logger, ModuleContext, ModuleDef } from "./module.js";

export interface LoadOptions {
  registry?: PermissionRegistry;
  events?: EventBus<EventMap>;
  routeMiddleware?: MiddlewareHandler;
  logger?: Logger;
}

export interface LoadResult {
  registry: PermissionRegistry;
  events: EventBus<EventMap>;
  loaded: string[];
  failed: { moduleId: string; reason: string }[];
  /** false se algum módulo falhou: o chamador deve pular a poda de permissões órfãs. */
  pruneSafe: boolean;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function loadModules(app: Hono, modules: ModuleDef[], options: LoadOptions = {}): Promise<LoadResult> {
  // Lança em ciclo, dependência desconhecida ou id duplicado, antes de montar qualquer coisa.
  const ordered = topoSort(modules);
  const registry = options.registry ?? new PermissionRegistry();
  const events = options.events ?? new EventBus<EventMap>();
  const logger: Logger = options.logger ?? console;
  const services = new Map<string, Map<string, unknown>>();
  const loaded: string[] = [];
  const failed: LoadResult["failed"] = [];
  const failedIds = new Set<string>();

  for (const def of ordered) {
    const dynamic: (() => PermissionItem[])[] = [];
    try {
      registry.registerProvider(def.id, () => [...(def.permissions?.items ?? []), ...dynamic.flatMap((p) => p())]);
    } catch (e) {
      throw new Error(`Falha ao registrar permissões do módulo "${def.id}": ${msg(e)}`, { cause: e });
    }

    const badDep = (def.dependsOn ?? []).find((d) => failedIds.has(d));
    if (badDep) {
      failedIds.add(def.id);
      failed.push({ moduleId: def.id, reason: `Dependência "${badDep}" falhou ao carregar.` });
      continue;
    }

    const routes = new Hono();
    if (options.routeMiddleware) routes.use("*", options.routeMiddleware);
    const own = new Map<string, unknown>();
    const offs: (() => void)[] = [];
    const track = (off: () => void): (() => void) => (offs.push(off), off);
    const ctx: ModuleContext = {
      moduleId: def.id,
      routes,
      events: {
        on: (e, h, o) => track(events.on(e, h, { ...o, module: def.id })),
        before: (e, h, o) => track(events.before(e, h, { ...o, module: def.id })),
        after: (e, h, o) => track(events.after(e, h, { ...o, module: def.id })),
        run: (e, p, a) => events.run(e, p, a),
      },
      permissions: {
        registerProvider: (p) => void dynamic.push(p),
        has: (u, k) => registry.has(u, k),
      },
      services: {
        expose: (name, impl) => {
          if (own.has(name)) throw new Error(`Serviço "${name}" já exposto pelo módulo "${def.id}".`);
          own.set(name, impl);
        },
        use: <T,>(moduleId: string, name: string): T => {
          if (!(def.dependsOn ?? []).includes(moduleId)) {
            throw new Error(`O módulo "${def.id}" não declarou dependência de "${moduleId}" em dependsOn.`);
          }
          const m = services.get(moduleId);
          if (!m?.has(name)) throw new Error(`Serviço "${name}" não exposto pelo módulo "${moduleId}".`);
          return m.get(name) as T;
        },
      },
      logger,
    };

    try {
      await def.register(ctx);
      app.route(`/api/m/${def.id}`, routes);
      services.set(def.id, own);
      loaded.push(def.id);
    } catch (e) {
      offs.forEach((off) => off()); // atomicidade: sem handlers residuais (serviços só são publicados no sucesso)
      failedIds.add(def.id);
      failed.push({ moduleId: def.id, reason: msg(e) });
      logger.error(`Módulo "${def.id}" falhou ao carregar: ${msg(e)}`, { cause: e });
    }
  }

  return { registry, events, loaded, failed, pruneSafe: failed.length === 0 };
}
