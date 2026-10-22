import type { User } from "@platform/shared";
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const roles = pgTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  fullname: text("fullname").notNull(),
  username: text("username").notNull().unique(),
  email: text("email"),
  passwordHash: text("password_hash").notNull(),
  roleId: text("role_id")
    .notNull()
    .references(() => roles.id),
  externals: jsonb("externals").$type<User["externals"]>().notNull().default({}),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  isAdmin: boolean("is_admin").notNull().default(false),
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const connections = pgTable("connections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  secretsEncrypted: text("secrets_encrypted").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status", { enum: ["open", "closed", "archived"] }).notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const auditLogEntries = pgTable(
  "audit_log_entries",
  {
    id: text("id").primaryKey(),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    // Sem FK para users: o autor segue identificável (id + nome da época) após a desativação.
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    plugin: text("plugin").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    schemaVersion: integer("schema_version").notNull(),
    summary: text("summary").notNull(),
  },
  (t) => [index("audit_log_target_idx").on(t.targetType, t.targetId), index("audit_log_occurred_idx").on(t.occurredAt)],
);
