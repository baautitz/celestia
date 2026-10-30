import { boolean, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/** Schema Postgres do Module `iam`. */
export const iamSchema = pgSchema("iam");

export const roles = iamSchema.table("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
});

export const users = iamSchema.table("users", {
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
});

/** Dispositivos homologados. Só guarda o fingerprint e os metadados do certificado; a chave privada nunca é gravada. */
export const devices = iamSchema.table("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["computer", "phone"] }).notNull(),
  status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
  fingerprint: text("fingerprint").notNull().unique(),
  serial: text("serial").notNull(),
  notAfter: timestamp("not_after").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by"),
  revokedAt: timestamp("revoked_at"),
  revokedBy: text("revoked_by"),
});
