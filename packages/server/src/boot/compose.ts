import type { Hono } from "hono";
import { loadModules, type LoadResult } from "@platform/core/loader";
import type { Logger, ModuleDef } from "@platform/core/module";
import { planMigrations, type ModuleMigrations } from "@platform/core/migrations";
import type { PermissionRegistry } from "@platform/core/permissions";

/** `base`: parte do Base System (falhar aborta o boot). `plugin`: falhar deixa o resto subir. */
export type ModuleTier = "base" | "plugin";

export interface ModuleEntry {
  tier: ModuleTier;
  def: ModuleDef;
}

export interface ComposeOptions {
  registry: PermissionRegistry;
  logger: Logger;
  /** Poda de Permissions órfãs; só é chamada quando todos os Modules carregaram. */
  prune(validKeys: ReadonlySet<string>): Promise<unknown>;
}

export interface ComposeResult extends LoadResult {
  pruned: boolean;
}

export async function composeModules(app: Hono, entries: ModuleEntry[], options: ComposeOptions): Promise<ComposeResult> {
  const result = await loadModules(app, entries.map((e) => e.def), { registry: options.registry, logger: options.logger });
  const tierOf = new Map(entries.map((e) => [e.def.id, e.tier]));
  const baseFailure = result.failed.find((f) => tierOf.get(f.moduleId) === "base");
  if (baseFailure) {
    throw new Error(`Module "${baseFailure.moduleId}" do Base System falhou ao carregar: ${baseFailure.reason}`);
  }
  if (!result.pruneSafe) {
    const names = result.failed.map((f) => f.moduleId).join(", ");
    options.logger.warn(`Poda de Permissions órfãs ignorada: Module(s) com falha: ${names}.`);
    return { ...result, pruned: false };
  }
  await options.prune(options.registry.allKeys());
  return { ...result, pruned: true };
}

/** Migrations dos Modules que as declaram, na ordem de dependência; cada item nomeia o Module. */
export function migrationPlan(defs: ModuleDef[]): ModuleMigrations[] {
  return planMigrations(
    defs.map((d) => ({
      id: d.id,
      dependsOn: d.dependsOn,
      migrations: d.migrations && { moduleId: d.id, folder: d.migrations.folder, schema: d.migrations.schema },
    })),
  );
}
