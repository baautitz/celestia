import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
