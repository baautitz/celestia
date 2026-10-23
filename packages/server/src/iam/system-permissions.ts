import type { PermissionItem } from "@platform/shared";
import { ERP_PERMISSIONS } from "../erp/erp-permissions.js";
import { IAM_PERMISSIONS } from "./iam-permissions.js";

/**
 * Catálogo estático das permissões nativas do sistema.
 * Todas seguem o formato: system:<modulo>:<acao>
 */
export const SYSTEM_PERMISSIONS: PermissionItem[] = [
  // Users e Roles vêm da declaração do Module `iam`; o agrupamento do catálogo usa o recurso como módulo.
  ...IAM_PERMISSIONS.items.map(({ key, label, description }) => ({ key, label, description, module: key.split(":")[1] })),

  // ERPs vêm da declaração do Plugin `erp`.
  ...ERP_PERMISSIONS.items.map(({ key, label, description }) => ({ key, label, description, module: key.split(":")[1] })),

  // ── Módulo: Auditoria ────────────────────────────────────
  {
    key: "system:audit:read",
    label: "Consultar Logs de Auditoria",
    description: "Permite visualizar o histórico de mutações e ações disparadas na plataforma.",
    module: "audit",
  },
];

/** Permissões `system:*` que ainda não pertencem a um Module (registradas pelo `iam` até serem modularizadas). */
export const NON_IAM_PERMISSIONS: PermissionItem[] = SYSTEM_PERMISSIONS.filter(
  (p) => ![...IAM_PERMISSIONS.items, ...ERP_PERMISSIONS.items].some((i) => i.key === p.key),
);

/**
 * Retorna as permissões do sistema agrupadas por módulo.
 */
export function getSystemPermissionsByModule(): Record<string, PermissionItem[]> {
  const grouped: Record<string, PermissionItem[]> = {};
  for (const perm of SYSTEM_PERMISSIONS) {
    const mod = perm.module || "general";
    if (!grouped[mod]) {
      grouped[mod] = [];
    }
    grouped[mod].push(perm);
  }
  return grouped;
}

/** Todas as chaves válidas (sem o curinga "*"). */
export const SYSTEM_PERMISSION_KEYS: ReadonlySet<string> = new Set(SYSTEM_PERMISSIONS.map((p) => p.key));

const GENERIC_DENIED = "Acesso negado: permissões insuficientes.";

/** Mensagem do 403 para a permissão `key`: a declarada junto dela, ou a genérica. */
export function denyMessage(key: string): string {
  return SYSTEM_PERMISSIONS.find((p) => p.key === key)?.deniedMessage ?? GENERIC_DENIED;
}
