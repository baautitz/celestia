/**
 * Mapeamento genérico de IDs do usuário nos ERPs conectados.
 * Exemplo: { "inovafarma": 42, "sap": 9001 }
 */
export type ExternalsMap = Record<string, string | number>;

/**
 * Modelo de Usuário da plataforma.
 */
export interface User {
  id: string;
  fullname: string;
  username: string;
  email?: string;
  passwordHash?: string;
  roleId: string;
  externals: ExternalsMap;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt?: string;
}

/**
 * Modelo de Perfil de Acesso (Role) que atua como agrupador de permissões.
 */
export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
}

/**
 * Payload completo do Access Token (JWT - 5 minutos).
 * Contém todos os dados necessários para que a autorização seja stateless.
 */
export interface JWTAccessPayload {
  sub: string;             // User ID (ex: "usr_1002")
  username: string;        // "joao.silva"
  fullname: string;        // "João da Silva"
  email?: string;
  role: string;            // ID da Role (ex: "role_vendedor")
  permissions: string[];   // Lista de permissões do usuário
  externals: ExternalsMap; // Mapeamento de chaves nos ERPs
  iat?: number;
  exp?: number;
}

/**
 * Payload do Refresh Token (JWT - 7 dias).
 */
export interface JWTRefreshPayload {
  sub: string;
  tokenId: string;
  type: "refresh";
  iat?: number;
  exp?: number;
}

/**
 * Resposta de sucesso de autenticação contendo os tokens e dados do usuário.
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // 300 segundos (5 minutos)
  user: JWTAccessPayload;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Inputs para endpoints de autenticação e gestão de usuários.
 */
export interface LoginInput {
  username: string;
  password: string;
}

export interface CreateUserInput {
  fullname: string;
  username: string;
  password: string;
  roleId: string;
  externals?: ExternalsMap;
  email?: string;
}

export interface UpdateUserInput {
  fullname?: string;
  roleId?: string;
  externals?: ExternalsMap;
  status?: "active" | "inactive";
  email?: string;
}

export interface ResetPasswordInput {
  newPassword: string;
}

export interface CreateRoleInput {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions: string[];
}

/**
 * Item individual no catálogo de permissões.
 */
export interface PermissionItem {
  key: string;         // Ex: "system:users:create", "recipe:fechamento_mes:action:adicionar_penalidade"
  label: string;       // Nome amigável para exibição
  description?: string;
  module?: string;     // Módulo no caso de system (ex: "users", "roles")
}

/**
 * Catálogo completo de permissões exposto para a UI de gestão de Roles.
 */
export interface RecipePermissionGroup {
  recipeId: string;
  recipeName: string;
  viewPermission: PermissionItem;
  queryPermissions: PermissionItem[];
  actionPermissions: PermissionItem[];
}

export interface PermissionCatalog {
  system: Record<string, PermissionItem[]>; // Agrupado por módulo
  recipes: RecipePermissionGroup[];        // Agrupado por Recipe
}
