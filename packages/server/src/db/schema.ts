import type { User } from "@platform/shared";
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const persistenceItems = pgTable(
  "persistence_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    collectionId: text("collection_id").notNull(),
    targetForeignKey: text("target_foreign_key").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("persistence_items_lookup_idx").on(table.workspaceId, table.collectionId, table.targetForeignKey)]
);

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const recipes = pgTable("recipes", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
