import { randomUUID } from "node:crypto";
import type {
  User,
  Role,
  CreateUserInput,
  UpdateUserInput,
} from "@platform/shared";
import { PasswordService } from "./password-service.js";
import { pruneOrphans } from "@platform/core/permissions";

export const LAST_ADMIN_MESSAGE = "O sistema precisa de ao menos um administrador ativo.";

/** Erro de domínio: a operação conflita com o estado atual (HTTP 409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Erro de domínio: o User ou a Role pedida não existe (HTTP 404). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A operação deixaria o sistema sem Administrator ativo. */
export class LastAdminError extends ConflictError {
  constructor() {
    super(LAST_ADMIN_MESSAGE);
  }
}

export class UsernameTakenError extends ConflictError {
  constructor(username: string) {
    super(`Usuário '${username}' já existe.`);
  }
}

export class RoleIdTakenError extends ConflictError {
  constructor(id: string) {
    super(`Role '${id}' já existe.`);
  }
}

export class RoleInUseError extends ConflictError {
  constructor(id: string) {
    super(`Não é possível excluir o grupo '${id}' pois existem usuários vinculados a ele.`);
  }
}

export class UserNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(`Usuário '${id}' não encontrado.`);
  }
}

export class RoleNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(`Role '${id}' não encontrada.`);
  }
}

export interface UserStore {
  findByUsername(username: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  createUser(input: CreateUserInput): Promise<User>;
  /**
   * Atualiza o usuário. Trocar Role ou inativar revoga os refresh tokens. `isAdmin` é aplicado na mesma
   * transação da checagem do último Administrator ativo (lança `LastAdminError`).
   */
  updateUser(id: string, input: UpdateUserInput): Promise<User>;
  /** Troca a senha e revoga os refresh tokens. */
  resetPassword(id: string, newPasswordHash: string): Promise<void>;
  /** Lança `LastAdminError` se for o último Administrator ativo. */
  deleteUser(id: string): Promise<void>;
  /** Invalida todos os refresh tokens já emitidos para o usuário (logout). */
  revokeSessions(id: string): Promise<void>;
  /** Define a flag de administrador (acesso total). Não exposta pela API: só CLI e testes. */
  setAdmin(id: string, isAdmin: boolean): Promise<void>;

  listRoles(): Promise<Role[]>;
  getRole(id: string): Promise<Role | null>;
  createRole(role: Role): Promise<Role>;
  updateRole(id: string, input: Partial<Role>): Promise<Role>;
  deleteRole(id: string): Promise<void>;

  /** Remove das roles as chaves ausentes de `validKeys` (preserva "*"); devolve quantas foram removidas. */
  syncOrphanPermissions(validKeys: ReadonlySet<string>): Promise<number>;

  /** Preferência do Usuário pela chave; `undefined` quando nunca foi salva. */
  getPreference(userId: string, key: string): Promise<unknown>;
  setPreference(userId: string, key: string, value: unknown): Promise<void>;
}

export class MemoryUserStore implements UserStore {
  private users = new Map<string, User>();
  private preferences = new Map<string, unknown>();

  async getPreference(userId: string, key: string): Promise<unknown> {
    return this.preferences.get(`${userId}\u0000${key}`);
  }

  async setPreference(userId: string, key: string, value: unknown): Promise<void> {
    this.preferences.set(`${userId}\u0000${key}`, value);
  }
  private roles = new Map<string, Role>();

  constructor(initialData?: { users?: User[]; roles?: Role[] }) {
    for (const r of initialData?.roles || []) this.roles.set(r.id, r);
    for (const u of initialData?.users || []) this.users.set(u.id, u);
  }

  async findByUsername(username: string): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === username.toLowerCase()) return { ...u };
    }
    return null;
  }

  async findById(id: string): Promise<User | null> {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async listUsers(): Promise<User[]> {
    return Array.from(this.users.values()).map((u) => {
      const copy = { ...u };
      delete copy.passwordHash; // Não expõe hash na listagem
      delete copy.sessionVersion;
      return copy;
    });
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const existing = await this.findByUsername(input.username);
    if (existing) {
      throw new UsernameTakenError(input.username);
    }

    const role = await this.getRole(input.roleId);
    if (!role) {
      throw new RoleNotFoundError(input.roleId);
    }

    const id = `usr_${randomUUID()}`;
    const user: User = {
      id,
      fullname: input.fullname,
      username: input.username,
      email: input.email,
      passwordHash: PasswordService.hash(input.password),
      roleId: input.roleId,
      status: "active",
      allowWithoutCertificate: input.allowWithoutCertificate ?? false,
      sessionVersion: 0,
      createdAt: new Date().toISOString(),
    };

    this.users.set(id, user);
    const returnUser = { ...user };
    delete returnUser.passwordHash;
    delete returnUser.sessionVersion;
    return returnUser;
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<User> {
    const user = this.users.get(id);
    if (!user) throw new UserNotFoundError(id);

    if (input.roleId) {
      const role = await this.getRole(input.roleId);
      if (!role) throw new RoleNotFoundError(input.roleId);
    }
    this.assertAdminRemains(user, { isAdmin: input.isAdmin ?? user.isAdmin ?? false, status: input.status ?? user.status });

    if (input.roleId && input.roleId !== user.roleId) this.revoke(user);
    if (input.status === "inactive" && user.status !== "inactive") this.revoke(user);
    // Mudar a regra de certificado encerra as sessões abertas sob a regra anterior.
    if (input.allowWithoutCertificate !== undefined && input.allowWithoutCertificate !== (user.allowWithoutCertificate ?? false)) this.revoke(user);
    // Ganhar ou perder o acesso de administrador muda o que o token carrega: encerra as sessões abertas.
    if (input.isAdmin !== undefined && input.isAdmin !== (user.isAdmin ?? false)) this.revoke(user);
    if (input.roleId) user.roleId = input.roleId;
    if (input.fullname !== undefined) user.fullname = input.fullname;
    if (input.email !== undefined) user.email = input.email || undefined;
    if (input.status) user.status = input.status;
    if (input.isAdmin !== undefined) user.isAdmin = input.isAdmin;
    if (input.allowWithoutCertificate !== undefined) user.allowWithoutCertificate = input.allowWithoutCertificate;
    user.updatedAt = new Date().toISOString();

    this.users.set(id, user);
    const returnUser = { ...user };
    delete returnUser.passwordHash;
    delete returnUser.sessionVersion;
    return returnUser;
  }

  private revoke(user: User): void {
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
  }

  /** Lança se `user`, ao assumir `after`, deixar de ser Administrator ativo e não houver outro. */
  private assertAdminRemains(user: User, after: { isAdmin: boolean; status: "active" | "inactive" }): void {
    const wasActiveAdmin = user.isAdmin === true && user.status === "active";
    if (!wasActiveAdmin || (after.isAdmin && after.status === "active")) return;
    const others = Array.from(this.users.values()).filter((u) => u.id !== user.id && u.isAdmin && u.status === "active");
    if (others.length === 0) throw new LastAdminError();
  }

  async revokeSessions(id: string): Promise<void> {
    const user = this.users.get(id);
    if (user) this.revoke(user);
  }

  async resetPassword(id: string, newPasswordHash: string): Promise<void> {
    const user = this.users.get(id);
    if (!user) throw new UserNotFoundError(id);
    user.passwordHash = newPasswordHash;
    this.revoke(user);
    user.updatedAt = new Date().toISOString();
    this.users.set(id, user);
  }

  async deleteUser(id: string): Promise<void> {
    const user = this.users.get(id);
    if (!user) throw new UserNotFoundError(id);
    this.assertAdminRemains(user, { isAdmin: false, status: "inactive" });
    this.users.delete(id);
  }

  async setAdmin(id: string, isAdmin: boolean): Promise<void> {
    const user = this.users.get(id);
    if (!user) throw new UserNotFoundError(id);
    this.assertAdminRemains(user, { isAdmin, status: user.status });
    if (isAdmin !== (user.isAdmin ?? false)) this.revoke(user);
    user.isAdmin = isAdmin;
  }

  async listRoles(): Promise<Role[]> {
    return Array.from(this.roles.values()).map((r) => ({ ...r, permissions: [...r.permissions] }));
  }

  async getRole(id: string): Promise<Role | null> {
    const r = this.roles.get(id);
    return r ? { ...r, permissions: [...r.permissions] } : null;
  }

  async createRole(role: Role): Promise<Role> {
    if (this.roles.has(role.id)) throw new RoleIdTakenError(role.id);
    this.roles.set(role.id, { ...role });
    return { ...role };
  }

  async updateRole(id: string, input: Partial<Role>): Promise<Role> {
    const role = this.roles.get(id);
    if (!role) throw new RoleNotFoundError(id);

    if (input.name !== undefined) role.name = input.name;
    if (input.description !== undefined) role.description = input.description;
    if (input.permissions) {
      // Retirar permissões encerra as sessões dos Users do grupo: o token já emitido ainda as carrega.
      if (role.permissions.some((key) => !input.permissions?.includes(key))) {
        for (const u of this.users.values()) if (u.roleId === id) this.revoke(u);
      }
      role.permissions = [...input.permissions];
    }

    this.roles.set(id, role);
    return { ...role };
  }

  async deleteRole(id: string): Promise<void> {
    // Impede excluir se houver usuário vinculado
    for (const u of this.users.values()) {
      if (u.roleId === id) {
        throw new RoleInUseError(id);
      }
    }
    this.roles.delete(id);
  }

  async syncOrphanPermissions(validKeys: ReadonlySet<string>): Promise<number> {
    let removed = 0;
    for (const role of this.roles.values()) {
      const kept = pruneOrphans(role.permissions, validKeys);
      removed += role.permissions.length - kept.length;
      role.permissions = kept;
    }
    return removed;
  }
}
