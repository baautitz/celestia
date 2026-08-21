import type {
  User,
  Role,
  CreateUserInput,
  UpdateUserInput,
  RecipeDef,
} from "@platform/shared";
import { PasswordService } from "./password-service.js";
import { SYSTEM_PERMISSIONS } from "./system-permissions.js";
import { PermissionCatalogEngine } from "./permission-catalog.js";

export interface UserStore {
  findByUsername(username: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  createUser(input: CreateUserInput): Promise<User>;
  updateUser(id: string, input: UpdateUserInput): Promise<User>;
  resetPassword(id: string, newPasswordHash: string): Promise<void>;
  deleteUser(id: string): Promise<void>;

  listRoles(): Promise<Role[]>;
  getRole(id: string): Promise<Role | null>;
  createRole(role: Role): Promise<Role>;
  updateRole(id: string, input: Partial<Role>): Promise<Role>;
  deleteRole(id: string): Promise<void>;

  syncOrphanPermissions(recipes: Record<string, RecipeDef>): Promise<number>;
}

export class MemoryUserStore implements UserStore {
  private users = new Map<string, User>();
  private roles = new Map<string, Role>();

  constructor(initialData?: { users?: User[]; roles?: Role[] }) {
    if (initialData?.roles && initialData.roles.length > 0) {
      for (const r of initialData.roles) this.roles.set(r.id, r);
    } else {
      this.seedDefaultRoles();
    }

    if (initialData?.users && initialData.users.length > 0) {
      for (const u of initialData.users) this.users.set(u.id, u);
    } else {
      this.seedDefaultUsers();
    }
  }

  private seedDefaultRoles() {
    // Role 1: Administrador (Todas as permissões do sistema + recipes)
    const adminPermissions = [
      ...SYSTEM_PERMISSIONS.map((p) => p.key),
      "recipe:fechamento_mes:view",
      "recipe:fechamento_mes:query:all",
      "recipe:fechamento_mes:query:self",
      "recipe:fechamento_mes:action:adicionar_penalidade",
      "recipe:fechamento_mes:action:visualizar_penalidades",
      "recipe:fechamento_mes:action:remover_penalidade",
    ];

    this.roles.set("role_admin", {
      id: "role_admin",
      name: "Administrador",
      description: "Acesso total à plataforma, gestão de usuários e criação de áreas de trabalho.",
      permissions: adminPermissions,
    });

    // Role 2: Operador de Fechamento
    this.roles.set("role_operador", {
      id: "role_operador",
      name: "Operador de Fechamento",
      description: "Acesso ao fechamento geral de vendas e aplicação de penalidades.",
      permissions: [
        "system:workspaces:create",
        "system:workspaces:close",
        "recipe:fechamento_mes:view",
        "recipe:fechamento_mes:query:all",
        "recipe:fechamento_mes:action:adicionar_penalidade",
        "recipe:fechamento_mes:action:visualizar_penalidades",
        "recipe:fechamento_mes:action:remover_penalidade",
      ],
    });

    // Role 3: Vendedor (Individual)
    this.roles.set("role_vendedor", {
      id: "role_vendedor",
      name: "Vendedor",
      description: "Acesso exclusivo ao relatório individual de suas próprias vendas.",
      permissions: [
        "recipe:fechamento_mes:view",
        "recipe:fechamento_mes:query:self",
        "recipe:fechamento_mes:action:visualizar_penalidades",
      ],
    });
  }

  private seedDefaultUsers() {
    const defaultPasswordHash = PasswordService.hash("Senha@123");

    this.users.set("usr_1001", {
      id: "usr_1001",
      fullname: "Carlos Oliveira",
      username: "carlos.admin",
      email: "carlos@farmacia.com.br",
      passwordHash: defaultPasswordHash,
      roleId: "role_admin",
      externals: { inovafarma: 1, sap: 9001 },
      status: "active",
      createdAt: new Date().toISOString(),
    });

    this.users.set("usr_1002", {
      id: "usr_1002",
      fullname: "João da Silva (Vendedor 42)",
      username: "joao.silva",
      email: "joao.silva@farmacia.com.br",
      passwordHash: defaultPasswordHash,
      roleId: "role_vendedor",
      externals: { inovafarma: 42, sap: 9042 },
      status: "active",
      createdAt: new Date().toISOString(),
    });

    this.users.set("usr_1003", {
      id: "usr_1003",
      fullname: "Maria Souza (Gerente)",
      username: "maria.souza",
      email: "maria.souza@farmacia.com.br",
      passwordHash: defaultPasswordHash,
      roleId: "role_operador",
      externals: { inovafarma: 99, sap: 9099 },
      status: "active",
      createdAt: new Date().toISOString(),
    });
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
      return copy;
    });
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const existing = await this.findByUsername(input.username);
    if (existing) {
      throw new Error(`Usuário '${input.username}' já existe.`);
    }

    const role = await this.getRole(input.roleId);
    if (!role) {
      throw new Error(`Role '${input.roleId}' não encontrada.`);
    }

    const id = `usr_${Date.now()}`;
    const user: User = {
      id,
      fullname: input.fullname,
      username: input.username,
      email: input.email,
      passwordHash: PasswordService.hash(input.password),
      roleId: input.roleId,
      externals: input.externals || {},
      status: "active",
      createdAt: new Date().toISOString(),
    };

    this.users.set(id, user);
    const returnUser = { ...user };
    delete returnUser.passwordHash;
    return returnUser;
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<User> {
    const user = this.users.get(id);
    if (!user) throw new Error(`Usuário '${id}' não encontrado.`);

    if (input.roleId) {
      const role = await this.getRole(input.roleId);
      if (!role) throw new Error(`Role '${input.roleId}' não encontrada.`);
      user.roleId = input.roleId;
    }

    if (input.fullname) user.fullname = input.fullname;
    if (input.email) user.email = input.email;
    if (input.status) user.status = input.status;
    if (input.externals) user.externals = { ...user.externals, ...input.externals };
    user.updatedAt = new Date().toISOString();

    this.users.set(id, user);
    const returnUser = { ...user };
    delete returnUser.passwordHash;
    return returnUser;
  }

  async resetPassword(id: string, newPasswordHash: string): Promise<void> {
    const user = this.users.get(id);
    if (!user) throw new Error(`Usuário '${id}' não encontrado.`);
    user.passwordHash = newPasswordHash;
    user.updatedAt = new Date().toISOString();
    this.users.set(id, user);
  }

  async deleteUser(id: string): Promise<void> {
    if (!this.users.has(id)) throw new Error(`Usuário '${id}' não encontrado.`);
    this.users.delete(id);
  }

  async listRoles(): Promise<Role[]> {
    return Array.from(this.roles.values()).map((r) => ({ ...r, permissions: [...r.permissions] }));
  }

  async getRole(id: string): Promise<Role | null> {
    const r = this.roles.get(id);
    return r ? { ...r, permissions: [...r.permissions] } : null;
  }

  async createRole(role: Role): Promise<Role> {
    if (this.roles.has(role.id)) throw new Error(`Role '${role.id}' já existe.`);
    this.roles.set(role.id, { ...role });
    return { ...role };
  }

  async updateRole(id: string, input: Partial<Role>): Promise<Role> {
    const role = this.roles.get(id);
    if (!role) throw new Error(`Role '${id}' não encontrada.`);

    if (input.name) role.name = input.name;
    if (input.description !== undefined) role.description = input.description;
    if (input.permissions) role.permissions = [...input.permissions];

    this.roles.set(id, role);
    return { ...role };
  }

  async deleteRole(id: string): Promise<void> {
    // Impede excluir se houver usuário vinculado
    for (const u of this.users.values()) {
      if (u.roleId === id) {
        throw new Error(`Não é possível excluir o grupo '${id}' pois existem usuários vinculados a ele.`);
      }
    }
    this.roles.delete(id);
  }

  async syncOrphanPermissions(recipes: Record<string, RecipeDef>): Promise<number> {
    const currentRoles = Array.from(this.roles.values());
    const { updatedRoles, removedCount } = PermissionCatalogEngine.pruneOrphanPermissions(
      currentRoles,
      recipes
    );

    for (const r of updatedRoles) {
      this.roles.set(r.id, r);
    }

    return removedCount;
  }
}
