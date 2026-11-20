import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Schema Postgres do Module `iam`. */
export const iamSchema = pgSchema("iam");

export const roles = iamSchema.table("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
});

export const users = iamSchema.table(
  "users",
  {
    id: text("id").primaryKey(),
    fullname: text("fullname").notNull(),
    username: text("username").notNull().unique(),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    isAdmin: boolean("is_admin").notNull().default(false),
    allowWithoutCertificate: boolean("allow_without_certificate").notNull().default(false),
    sessionVersion: integer("session_version").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  // O login compara sem diferenciar maiúsculas: o índice impede dois usernames que só diferem na caixa.
  (t) => [uniqueIndex("users_username_lower_key").on(sql`lower(${t.username})`)],
);

/** Preferência do Usuário (p.ex. a visualização escolhida numa tela): `value` é opaco para o iam. */
export const userPreferences = iamSchema.table(
  "user_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/** Refresh token opaco: guarda só o hash (SHA-256); o token em claro vive apenas no cookie do navegador. */
export const sessions = iamSchema.table(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userSessionVersion: integer("user_session_version").notNull(),
    deviceId: text("device_id"),
    familyId: text("family_id").notNull(),
    issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    usedAt: bigint("used_at", { mode: "number" }),
    lockedAt: bigint("locked_at", { mode: "number" }),
  },
  (t) => [index("sessions_family_idx").on(t.familyId), index("sessions_expires_idx").on(t.expiresAt)],
);
