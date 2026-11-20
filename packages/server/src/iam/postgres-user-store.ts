import { randomUUID } from "node:crypto";
import { and, count, eq, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CreateUserInput, Role, UpdateUserInput, User } from "@platform/shared";
import { returned } from "../db/returned.js";
import { roles, userPreferences, users } from "./schema.js";
import { PasswordService } from "./password-service.js";
import { pruneOrphans } from "@platform/core/permissions";
import {
  LastAdminError,
  RoleIdTakenError,
  RoleInUseError,
  RoleNotFoundError,
  UserNotFoundError,
  UsernameTakenError,
  type UserStore,
} from "./user-store.js";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/** Código SQLSTATE de um erro do driver `pg` (possivelmente embrulhado em `cause` pelo Drizzle). */
function pgCode(err: unknown): string | undefined {
  for (let current = err; current instanceof Error; current = current.cause) {
    if ("code" in current && typeof current.code === "string") return current.code;
  }
  return undefined;
}

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
    allowWithoutCertificate: row.allowWithoutCertificate,
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

  async getPreference(userId: string, key: string): Promise<unknown> {
    const [row] = await this.db
      .select({ value: userPreferences.value })
      .from(userPreferences)
      .where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, key)))
      .limit(1);
    return row?.value;
  }

  async setPreference(userId: string, key: string, value: unknown): Promise<void> {
    await this.db
      .insert(userPreferences)
      .values({ userId, key, value })
      .onConflictDoUpdate({ target: [userPreferences.userId, userPreferences.key], set: { value, updatedAt: new Date() } });
  }

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
    if (!(await this.getRole(input.roleId))) throw new RoleNotFoundError(input.roleId);

    try {
      const [row] = await this.db
        .insert(users)
        .values({
          id: `usr_${randomUUID()}`,
          fullname: input.fullname,
          username: input.username,
          email: input.email || null,
          passwordHash: PasswordService.hash(input.password),
          roleId: input.roleId,
          allowWithoutCertificate: input.allowWithoutCertificate ?? false,
        })
        .returning();
      return toUser(returned(row));
    } catch (err: unknown) {
      // O índice único em lower(username) decide a corrida entre dois cadastros simultâneos.
      if (pgCode(err) === UNIQUE_VIOLATION) throw new UsernameTakenError(input.username);
      if (pgCode(err) === FOREIGN_KEY_VIOLATION) throw new RoleNotFoundError(input.roleId);
      throw err;
    }
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<User> {
    if (input.roleId && !(await this.getRole(input.roleId))) {
      throw new RoleNotFoundError(input.roleId);
    }

    return this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, id);
      const status = input.status ?? user.status;
      const isAdmin = input.isAdmin ?? user.isAdmin;
      await this.assertAdminRemains(tx, user, { isAdmin, status });
      const revoke = (input.roleId !== undefined && input.roleId !== user.roleId) || (input.status === "inactive" && user.status !== "inactive") ||
        // Mudar a regra de certificado encerra as sessões abertas sob a regra anterior.
        (input.allowWithoutCertificate !== undefined && input.allowWithoutCertificate !== user.allowWithoutCertificate) ||
        // Ganhar ou perder o acesso de administrador muda o que o token carrega.
        (input.isAdmin !== undefined && input.isAdmin !== user.isAdmin);

      const [row] = await tx
        .update(users)
        .set({
          roleId: input.roleId || user.roleId,
          fullname: input.fullname ?? user.fullname,
          // Texto vazio limpa o e-mail; ausente mantém.
          email: input.email === undefined ? user.email : input.email || null,
          status,
          ...(input.isAdmin !== undefined ? { isAdmin: input.isAdmin } : {}),
          ...(input.allowWithoutCertificate !== undefined ? { allowWithoutCertificate: input.allowWithoutCertificate } : {}),
          ...(revoke ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();
      return toUser(returned(row));
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
    if (!row) throw new UserNotFoundError(id);
    return row;
  }

  async resetPassword(id: string, newPasswordHash: string): Promise<void> {
    const updated = await this.db
      .update(users)
      .set({ passwordHash: newPasswordHash, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (updated.length === 0) throw new UserNotFoundError(id);
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
      await tx
        .update(users)
        .set({ isAdmin, ...(isAdmin !== user.isAdmin ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}) })
        .where(eq(users.id, id));
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
    try {
      const [row] = await this.db.insert(roles).values(role).returning();
      return toRole(returned(row));
    } catch (err: unknown) {
      if (pgCode(err) === UNIQUE_VIOLATION) throw new RoleIdTakenError(role.id);
      throw err;
    }
  }

  async updateRole(id: string, input: Partial<Role>): Promise<Role> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(roles).where(eq(roles.id, id)).for("update").limit(1);
      if (!current) throw new RoleNotFoundError(id);

      const [row] = await tx
        .update(roles)
        .set({
          name: input.name ?? current.name,
          description: input.description !== undefined ? input.description : current.description,
          permissions: input.permissions ? [...input.permissions] : current.permissions,
        })
        .where(eq(roles.id, id))
        .returning();

      // Retirar permissões encerra as sessões dos Users do grupo: o token já emitido ainda as carrega.
      if (input.permissions && current.permissions.some((key) => !input.permissions?.includes(key))) {
        await tx.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.roleId, id));
      }
      return toRole(returned(row));
    });
  }

  async deleteRole(id: string): Promise<void> {
    const [linked] = await this.db.select({ total: count() }).from(users).where(eq(users.roleId, id));
    if (linked === undefined) throw new Error("A contagem de usuários vinculados não retornou.");
    if (linked.total > 0) {
      throw new RoleInUseError(id);
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
