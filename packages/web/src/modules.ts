import type { NavEntry, WebModule } from "@platform/ui/contracts/module";
import { coreModule } from "./modules/core";
import { closingPeriodModule } from "./modules/closing-period";

// Registro estático: um import explícito por módulo, na ordem do menu.
export const modules: WebModule[] = [coreModule, closingPeriodModule];

export const allEntries: NavEntry[] = modules.flatMap((m) => m.entries);

export const accessibleEntries = (hasPermission: (permission: string) => boolean): NavEntry[] =>
  allEntries.filter((e) => hasPermission(e.permission));
