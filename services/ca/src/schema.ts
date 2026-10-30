import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/** Schema Postgres da autoridade certificadora. */
export const caSchema = pgSchema("ca");

/** Dispositivos homologados. Só guarda o fingerprint e os metadados do certificado; a chave privada nunca é gravada. */
export const devices = caSchema.table("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
  fingerprint: text("fingerprint").notNull().unique(),
  serial: text("serial").notNull(),
  notAfter: timestamp("not_after").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by"),
  revokedAt: timestamp("revoked_at"),
  revokedBy: text("revoked_by"),
});
