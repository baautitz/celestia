import type { PermissionItem } from "@platform/shared";

/**
 * Catálogo estático das permissões nativas do sistema.
 * Todas seguem o formato: system:<modulo>:<acao>
 */
export const SYSTEM_PERMISSIONS: PermissionItem[] = [
  // ── Módulo: Usuários ───────────────────────────────────
  {
    key: "system:users:create",
    label: "Criar Usuários",
    description: "Permite cadastrar novos operadores e administradores no sistema.",
    module: "users",
  },
  {
    key: "system:users:read",
    label: "Visualizar Usuários",
    description: "Permite listar e visualizar o perfil e dados cadastrais dos usuários.",
    module: "users",
  },
  {
    key: "system:users:update",
    label: "Editar Usuários",
    description: "Permite alterar nome, cargo e mapeamento de IDs de ERP (externals) de usuários.",
    module: "users",
  },
  {
    key: "system:users:reset_password",
    label: "Redefinir Senha de Usuários",
    description: "Permite ao administrador definir uma nova senha para qualquer usuário.",
    module: "users",
  },
  {
    key: "system:users:delete",
    label: "Inativar/Excluir Usuários",
    description: "Permite desativar ou excluir contas de usuários.",
    module: "users",
  },

  // ── Módulo: Perfis e Permissões (Roles) ─────────────────
  {
    key: "system:roles:create",
    label: "Criar Grupos de Acesso",
    description: "Permite criar novos perfis/cargos de permissão.",
    module: "roles",
  },
  {
    key: "system:roles:read",
    label: "Visualizar Grupos e Catálogo",
    description: "Permite listar perfis de acesso e inspecionar o catálogo de permissões.",
    module: "roles",
  },
  {
    key: "system:roles:update",
    label: "Editar Permissões do Grupo",
    description: "Permite alterar quais permissões do sistema e recipes pertencem a cada grupo.",
    module: "roles",
  },
  {
    key: "system:roles:delete",
    label: "Excluir Grupos de Acesso",
    description: "Permite remover perfis que não estejam em uso.",
    module: "roles",
  },

  // ── Módulo: Áreas de Trabalho (Workspaces) ───────────────
  {
    key: "system:workspaces:create",
    label: "Criar Áreas de Trabalho",
    description: "Permite instanciar uma nova área de trabalho a partir de um Modelo.",
    module: "workspaces",
  },
  {
    key: "system:workspaces:update",
    label: "Editar Áreas de Trabalho",
    description: "Permite alterar o título, o período e os parâmetros de áreas de trabalho existentes.",
    module: "workspaces",
  },
  {
    key: "system:workspaces:delete",
    label: "Excluir Áreas de Trabalho",
    description: "Permite excluir instâncias de áreas de trabalho.",
    module: "workspaces",
  },
  {
    key: "system:workspaces:close",
    label: "Concluir/Travar Áreas de Trabalho",
    description: "Permite finalizar e travar áreas de trabalho contra novas edições.",
    module: "workspaces",
  },
  {
    key: "system:workspaces:reopen",
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
