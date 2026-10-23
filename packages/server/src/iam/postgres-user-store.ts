import { randomUUID } from "node:crypto";
import { and, count, eq, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CreateUserInput, Role, UpdateUserInput, User } from "@platform/shared";
import { roles, users } from "./schema.js";
import { PasswordService } from "./password-service.js";
import { pruneOrphans } from "@platform/core/permissions";
import { LastAdminError, type UserStore } from "./user-store.js";

type UserRow = typeof users.$inferSelect;
type RoleRow = typeof roles.$inferSelect;
type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

function toUser(row: UserRow, withHash = false): User {
  return {
    id: row.id,
    fullname: row.fullname,
    username: row.username,
    email: row.email ?? undefined,
    ...(withHash ? { passwordHash: row.passwordHash, sessionVersion: row.sessionVersion } : {}),
    roleId: row.roleId,
    status: row.status,
    isAdmin: row.isAdmin,
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
      })
      .returning();
    return toUser(row!);
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<User> {
    if (input.roleId && !(await this.getRole(input.roleId))) {
      throw new Error(`Role '${input.roleId}' não encontrada.`);
    }

    return this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, id);
      const status = input.status ?? user.status;
      const isAdmin = input.isAdmin ?? user.isAdmin;
      await this.assertAdminRemains(tx, user, { isAdmin, status });
      const revoke = (input.roleId !== undefined && input.roleId !== user.roleId) || (input.status === "inactive" && user.status !== "inactive");

      const [row] = await tx
        .update(users)
        .set({
          roleId: input.roleId || user.roleId,
          fullname: input.fullname || user.fullname,
          email: input.email || user.email,
          status,
          ...(input.isAdmin !== undefined ? { isAdmin: input.isAdmin } : {}),
          ...(revoke ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();
      return toUser(row!);
    });
  }

  /**
   * Trava as linhas dos Administrators ativos (em ordem de id, sem deadlock) e recusa a mudança se `user`
   * deixaria de ser Administrator ativo sendo o último. Transações concorrentes se serializam aqui.
   */
  private async assertAdminRemains(
    tx: Tx,
    user: UserRow,
    after: { isAdmin: boolean; status: "active" | "inactive" },
  ): Promise<void> {
    if (!(user.isAdmin && user.status === "active") || (after.isAdmin && after.status === "active")) return;
    const active = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.isAdmin, true), eq(users.status, "active")))
      .orderBy(users.id)
      .for("update");
    if (!active.some((a) => a.id !== user.id)) throw new LastAdminError();
  }

  /**
   * Trava, numa só consulta ordenada por id (sem deadlock), a linha do usuário e as dos Administrators ativos,
   * e devolve o usuário já lido sob o lock.
   */
  private async lockUser(tx: Tx, id: string): Promise<UserRow> {
    const locked = await tx
      .select()
      .from(users)
      .where(or(eq(users.id, id), and(eq(users.isAdmin, true), eq(users.status, "active"))))
      .orderBy(users.id)
      .for("update");
    const row = locked.find((u) => u.id === id);
    if (!row) throw new Error(`Usuário '${id}' não encontrado.`);
    return row;
  }

  async resetPassword(id: string, newPasswordHash: string): Promise<void> {
    const updated = await this.db
      .update(users)
      .set({ passwordHash: newPasswordHash, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (updated.length === 0) throw new Error(`Usuário '${id}' não encontrado.`);
  }

  async revokeSessions(id: string): Promise<void> {
    await this.db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, id));
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, id);
      await this.assertAdminRemains(tx, user, { isAdmin: false, status: "inactive" });
      await tx.delete(users).where(eq(users.id, id));
    });
  }

  async setAdmin(id: string, isAdmin: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, id);
      await this.assertAdminRemains(tx, user, { isAdmin, status: user.status });
      await tx.update(users).set({ isAdmin }).where(eq(users.id, id));
    });
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

  async syncOrphanPermissions(validKeys: ReadonlySet<string>): Promise<number> {
    let removed = 0;
    for (const role of await this.listRoles()) {
      const kept = pruneOrphans(role.permissions, validKeys);
      if (kept.length === role.permissions.length) continue;
      removed += role.permissions.length - kept.length;
      await this.db.update(roles).set({ permissions: kept }).where(eq(roles.id, role.id));
    }
    return removed;
  }
}
