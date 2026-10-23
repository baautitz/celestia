import { jsonb, pgSchema, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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

/** Externals: valores que mapeiam um User do iam aos conceitos de um ERP (campos declarados pelo ERP Driver). */
export const erpUserExternals = erpSchema.table(
  "user_externals",
  {
    userId: text("user_id").notNull(),
    erpId: text("erp_id")
      .notNull()
      .references(() => erps.id, { onDelete: "cascade" }),
    values: jsonb("values").$type<Record<string, string | number>>().notNull().default({}),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.erpId] })]
);
