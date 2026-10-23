import type { NavEntry, WebModule } from "@platform/ui/contracts/module";
import { canSeeEntry } from "./lib/entry-screen";
import { coreModule } from "./modules/core";
import { auditModule } from "./modules/audit";
import { closingPeriodModule } from "./modules/closing-period";
import { exampleWebModule } from "@integrations/example/web";
import { inovafarmaWebModule } from "@integrations/inovafarma/web";

// Registro estático: um import explícito por módulo, na ordem do menu.
export const modules: WebModule[] = [coreModule, closingPeriodModule, auditModule, exampleWebModule, inovafarmaWebModule];

export const allEntries: NavEntry[] = modules.flatMap((m) => m.entries);

export const accessibleEntries = (hasPermission: (permission: string) => boolean): NavEntry[] =>
  allEntries.filter((e) => canSeeEntry(e, hasPermission));
