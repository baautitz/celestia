import type { PermissionItem } from "@platform/shared";
import { IAM_PERMISSIONS } from "./iam-permissions.js";

/**
 * Catálogo estático das permissões nativas do sistema.
 * Todas seguem o formato: system:<modulo>:<acao>
 */
export const SYSTEM_PERMISSIONS: PermissionItem[] = [
  // Users e Roles vêm da declaração do Module `iam`; o agrupamento do catálogo usa o recurso como módulo.
  ...IAM_PERMISSIONS.items.map(({ key, label, description }) => ({ key, label, description, module: key.split(":")[1] })),

  // ── Módulo: Áreas de Trabalho (Workspaces) ───────────────
  {
    key: "system:workspaces:create",
    deniedMessage: "Acesso negado: o usuário não possui permissão para criar Áreas de Trabalho.",
    label: "Criar Áreas de Trabalho",
    description: "Permite instanciar uma nova área de trabalho a partir de um Modelo.",
    module: "workspaces",
  },
  {
    key: "system:workspaces:read",
    deniedMessage: "Acesso negado: o usuário não possui permissão para visualizar Áreas de Trabalho.",
    label: "Visualizar Áreas de Trabalho",
    description: "Permite listar e abrir áreas de trabalho e consultar seus dados persistidos.",
    module: "workspaces",
  },
  {
    key: "system:workspaces:update",
    deniedMessage: "Acesso negado: o usuário não possui permissão para editar Áreas de Trabalho.",
    label: "Editar Áreas de Trabalho",
    description: "Permite alterar o título, o período e os parâmetros de áreas de trabalho existentes.",
    module: "workspaces",
  },
  {
    key: "system:workspaces:delete",
    deniedMessage: "Acesso negado: o usuário não possui permissão para excluir Áreas de Trabalho (system:workspaces:delete).",
    label: "Excluir Áreas de Trabalho",
    description: "Permite excluir instâncias de áreas de trabalho.",
    module: "workspaces",
  },
  {
    key: "system:workspaces:close",
    deniedMessage: "Acesso negado: o usuário não possui permissão para concluir Áreas de Trabalho.",
    label: "Concluir/Travar Áreas de Trabalho",
    description: "Permite finalizar e travar áreas de trabalho contra novas edições.",
    module: "workspaces",
  },
  {
    key: "system:workspaces:reopen",
    deniedMessage: "Acesso negado: o usuário não possui permissão para reabrir Áreas de Trabalho (system:workspaces:reopen).",
    label: "Reabrir Áreas de Trabalho",
    description: "Permite reabrir áreas de trabalho concluídas para novas edições e ações.",
    module: "workspaces",
  },

  // ── Módulo: Fontes de Dados (Sources) ────────────────────
  {
    key: "system:sources:manage",
    label: "Gerenciar Fontes de Dados",
    description: "Permite configurar e testar conexões com ERPs externos (SQL Server, Postgres).",
    module: "sources",
  },

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
  (p) => !IAM_PERMISSIONS.items.some((i) => i.key === p.key),
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
