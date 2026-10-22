import type { NavEntry, WebModule } from "@platform/ui/contracts/module";
import { canSeeEntry } from "./lib/entry-screen";
import { coreModule } from "./modules/core";
import { auditModule } from "./modules/audit";

// Registro estático: um import explícito por módulo, na ordem do menu.
export const modules: WebModule[] = [coreModule, auditModule];

export const allEntries: NavEntry[] = modules.flatMap((m) => m.entries);

export const accessibleEntries = (hasPermission: (permission: string) => boolean): NavEntry[] =>
  allEntries.filter((e) => canSeeEntry(e, hasPermission));
