import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CreateUserInput, RecipeDef, Role, UpdateUserInput, User } from "@platform/shared";
import { roles, users } from "../db/schema.js";
import { PasswordService } from "./password-service.js";
import { PermissionCatalogEngine } from "./permission-catalog.js";
import type { UserStore } from "./user-store.js";

type UserRow = typeof users.$inferSelect;
type RoleRow = typeof roles.$inferSelect;

function toUser(row: UserRow, withHash = false): User {
  return {
    id: row.id,
    fullname: row.fullname,
    username: row.username,
    email: row.email ?? undefined,
    ...(withHash ? { passwordHash: row.passwordHash } : {}),
    roleId: row.roleId,
    externals: row.externals,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  };
}

function toRole(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    permissions: row.permissions,
  };
}

export class PostgresUserStore implements UserStore {
  constructor(private db: NodePgDatabase) {}

  async findByUsername(username: string): Promise<User | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
      .limit(1);
    return row ? toUser(row, true) : null;
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toUser(row, true) : null;
  }

  async listUsers(): Promise<User[]> {
    const rows = await this.db.select().from(users).orderBy(users.createdAt);
    return rows.map((row) => toUser(row));
  }

  async createUser(input: CreateUserInput): Promise<User> {
    if (await this.findByUsername(input.username)) {
      throw new Error(`Usuário '${input.username}' já existe.`);
    }
    if (!(await this.getRole(input.roleId))) {
      throw new Error(`Role '${input.roleId}' não encontrada.`);
    }

    const [row] = await this.db
      .insert(users)
      .values({
        id: `usr_${randomUUID()}`,
        fullname: input.fullname,
        username: input.username,
        email: input.email,
        passwordHash: PasswordService.hash(input.password),
        roleId: input.roleId,
        externals: input.externals || {},
      })
      .returning();
    return toUser(row!);
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<User> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new Error(`Usuário '${id}' não encontrado.`);

    if (input.roleId && !(await this.getRole(input.roleId))) {
      throw new Error(`Role '${input.roleId}' não encontrada.`);
    }

    const [row] = await this.db
      .update(users)
      .set({
        roleId: input.roleId || user.roleId,
        fullname: input.fullname || user.fullname,
        email: input.email || user.email,
        status: input.status || user.status,
        externals: input.externals ? { ...user.externals, ...input.externals } : user.externals,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return toUser(row!);
  }

  async resetPassword(id: string, newPasswordHash: string): Promise<void> {
    const updated = await this.db
      .update(users)
      .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (updated.length === 0) throw new Error(`Usuário '${id}' não encontrado.`);
  }

  async deleteUser(id: string): Promise<void> {
    const deleted = await this.db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    if (deleted.length === 0) throw new Error(`Usuário '${id}' não encontrado.`);
  }

  async listRoles(): Promise<Role[]> {
    const rows = await this.db.select().from(roles).orderBy(roles.name);
    return rows.map(toRole);
  }

  async getRole(id: string): Promise<Role | null> {
    const [row] = await this.db.select().from(roles).where(eq(roles.id, id)).limit(1);
    return row ? toRole(row) : null;
  }

  async createRole(role: Role): Promise<Role> {
    if (await this.getRole(role.id)) throw new Error(`Role '${role.id}' já existe.`);
    const [row] = await this.db.insert(roles).values(role).returning();
    return toRole(row!);
  }

  async updateRole(id: string, input: Partial<Role>): Promise<Role> {
    const role = await this.getRole(id);
    if (!role) throw new Error(`Role '${id}' não encontrada.`);

    const [row] = await this.db
      .update(roles)
      .set({
        name: input.name || role.name,
        description: input.description !== undefined ? input.description : role.description,
        permissions: input.permissions ? [...input.permissions] : role.permissions,
      })
      .where(eq(roles.id, id))
      .returning();
    return toRole(row!);
  }

  async deleteRole(id: string): Promise<void> {
    const [linked] = await this.db.select({ total: count() }).from(users).where(eq(users.roleId, id));
    if (linked!.total > 0) {
      throw new Error(`Não é possível excluir o grupo '${id}' pois existem usuários vinculados a ele.`);
    }
    await this.db.delete(roles).where(eq(roles.id, id));
  }

  async syncOrphanPermissions(recipes: Record<string, RecipeDef>): Promise<number> {
    const { updatedRoles, removedCount } = PermissionCatalogEngine.pruneOrphanPermissions(
      await this.listRoles(),
      recipes
    );
    for (const role of updatedRoles) {
      await this.db.update(roles).set({ permissions: role.permissions }).where(eq(roles.id, role.id));
    }
    return removedCount;
  }
}
