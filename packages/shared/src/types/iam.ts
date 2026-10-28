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
  status: "active" | "inactive";
  /** Administrador: ignora a matriz de permissões (acesso total). Alterado pelo CLI create-admin ou por outro administrador. */
  isAdmin?: boolean;
  /** Interno (como passwordHash): só em findById; nunca em respostas da API. Invalida refresh tokens antigos. */
  sessionVersion?: number;
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
  role: string;            // ID da Role (ex: "role_colaborador")
  permissions: string[];   // Lista de permissões do usuário
  isAdmin?: boolean;       // Administrador: o servidor expande para todas as permissões válidas
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
  /** Versão de sessão do usuário na emissão; o refresh só vale enquanto for igual à atual. */
  ver: number;
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
  email?: string;
}

export interface UpdateUserInput {
  fullname?: string;
  roleId?: string;
  status?: "active" | "inactive";
  email?: string;
  /** Promove ou rebaixa Administrator; aplicado na mesma transação da checagem do último admin ativo. */
  isAdmin?: boolean;
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
  key: string;         // Ex: "system:users:create", "closing_period:period:create"
  label: string;       // Nome amigável para exibição
  description?: string;
  module?: string;     // Módulo no caso de system (ex: "users", "roles")
  deniedMessage?: string; // Mensagem do 403 quando a permissão falta (declarada junto da permissão)
}

/**
 * Catálogo de permissões exposto para a UI de gestão de Roles.
 */
export interface PermissionCatalog {
  system: Record<string, PermissionItem[]>; // Agrupado por módulo
}
