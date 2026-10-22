import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/** Um schema Postgres por Module (ADR 0004). */
export const closingPeriodSchema = pgSchema("closing_period");

export const periods = closingPeriodSchema.table("periods", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
