import { jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/** Schema Postgres do Plugin `erp` (um schema por Module). */
export const erpSchema = pgSchema("erp");

export const erps = erpSchema.table("erps", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  driver: text("driver").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  secretsEncrypted: text("secrets_encrypted").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
