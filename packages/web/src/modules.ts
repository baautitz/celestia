import type { NavEntry, WebModule } from "@platform/ui/contracts/module";
import { buildMenu } from "./lib/menu";
import { buildWebServices } from "@platform/ui/contracts/web-services";
import { coreModule } from "./modules/core";
import { iamModule } from "./modules/iam";
import { auditModule } from "./modules/audit";
import { closingPeriodModule } from "./modules/closing-period";
import { inovafarmaWebModule } from "@integrations/inovafarma/web";

// Registro estático: um import explícito por módulo, a ordem visual vem das Seções e `order` (lib/menu.ts).
export const modules: WebModule[] = [coreModule, iamModule, closingPeriodModule, auditModule, inovafarmaWebModule];

/** Serviços entre módulos web; lança no boot se um `dependsOn` não estiver registrado antes. */
export const webServices = buildWebServices(modules);

export const allEntries: NavEntry[] = modules.flatMap((m) => m.entries);

export const menuSections = (hasPermission: (permission: string) => boolean) => buildMenu(modules, hasPermission);

/** Entradas acessíveis na ordem visual do menu. */
export const accessibleEntries = (hasPermission: (permission: string) => boolean): NavEntry[] =>
  menuSections(hasPermission).flatMap((s) => s.entries);
