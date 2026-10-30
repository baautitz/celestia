import { index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/** Schema Postgres do Module `audit`. */
export const auditSchema = pgSchema("audit");

export const auditLogEntries = auditSchema.table(
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
