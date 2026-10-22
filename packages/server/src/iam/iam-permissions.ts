import { definePermissions } from "@platform/core/permissions";

/** Permissões de Users e Roles, declaradas pelo Module `iam` (chaves `system:<recurso>:<acao>`). */
export const IAM_PERMISSIONS = definePermissions("system", {
  "users:create": { label: "Criar Usuários", description: "Permite cadastrar novos operadores e administradores no sistema." },
  "users:read": { label: "Visualizar Usuários", description: "Permite listar e visualizar o perfil e dados cadastrais dos usuários." },
  "users:update": { label: "Editar Usuários", description: "Permite alterar nome, cargo e mapeamento de IDs de ERP (externals) de usuários." },
  "users:reset_password": { label: "Redefinir Senha de Usuários", description: "Permite ao administrador definir uma nova senha para qualquer usuário." },
  "users:delete": { label: "Inativar/Excluir Usuários", description: "Permite desativar ou excluir contas de usuários." },
  "roles:create": { label: "Criar Grupos de Acesso", description: "Permite criar novos perfis/cargos de permissão." },
  "roles:read": { label: "Visualizar Grupos e Catálogo", description: "Permite listar perfis de acesso e inspecionar o catálogo de permissões." },
  "roles:update": { label: "Editar Permissões do Grupo", description: "Permite alterar quais permissões do sistema pertencem a cada grupo." },
  "roles:delete": { label: "Excluir Grupos de Acesso", description: "Permite remover perfis que não estejam em uso." },
});
