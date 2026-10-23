import type { Role } from "@platform/shared";
import { CLOSING_PERIOD_PERMISSIONS } from "../closing-period/closing-period-permissions.js";
import { SYSTEM_PERMISSIONS } from "./system-permissions.js";

/** Role inicial vinculada ao primeiro Administrator criado via CLI. */
export const DEFAULT_ADMIN_ROLE_ID = "gestor";

/**
 * Roles iniciais semeados na migration do Module `iam`.
 * Se algum Plugin não estiver no build, `syncOrphanPermissions` poda as chaves ausentes no boot.
 */
export const INITIAL_ROLES: readonly Role[] = [
  {
    id: "gestor",
    name: "Gestor",
    description: "Gestão de usuários, perfis, ERPs, períodos de fechamento e consulta de auditoria.",
    permissions: [...SYSTEM_PERMISSIONS, ...CLOSING_PERIOD_PERMISSIONS.items].map((p) => p.key),
  },
  {
    id: "operador",
    name: "Operador",
    description: "Operação de períodos de fechamento.",
    permissions: [
      CLOSING_PERIOD_PERMISSIONS.keys["period:read"],
      CLOSING_PERIOD_PERMISSIONS.keys["period:create"],
      CLOSING_PERIOD_PERMISSIONS.keys["period:update"],
      CLOSING_PERIOD_PERMISSIONS.keys["period:close"],
    ],
  },
];
