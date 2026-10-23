import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ClosingPeriodRecord } from "@platform/shared";
import type { ClosingPeriodStore } from "./closing-period-store.js";
import { periods } from "./schema.js";

type Row = typeof periods.$inferSelect;

function toRecord(row: Row): ClosingPeriodRecord {
  return {
    id: row.id,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PostgresClosingPeriodStore implements ClosingPeriodStore {
  constructor(private db: NodePgDatabase) {}

  async list(): Promise<ClosingPeriodRecord[]> {
    return (await this.db.select().from(periods).orderBy(periods.startDate)).map(toRecord);
  }

  async get(id: string): Promise<ClosingPeriodRecord | null> {
    const [row] = await this.db.select().from(periods).where(eq(periods.id, id));
    return row ? toRecord(row) : null;
  }

  async save(period: ClosingPeriodRecord): Promise<void> {
    const values = {
      id: period.id,
      name: period.name,
      startDate: period.startDate,
      endDate: period.endDate,
      status: period.status,
      version: period.version,
      createdAt: new Date(period.createdAt),
      updatedAt: new Date(period.updatedAt),
    };
    await this.db.insert(periods).values(values).onConflictDoUpdate({ target: periods.id, set: values });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(periods).where(eq(periods.id, id));
  }

  async updateIfCurrent(period: ClosingPeriodRecord, expectedVersion: number): Promise<boolean> {
    const updated = await this.db
      .update(periods)
      .set({
        startDate: period.startDate,
        endDate: period.endDate,
        version: period.version,
        updatedAt: new Date(period.updatedAt),
      })
      .where(and(eq(periods.id, period.id), eq(periods.version, expectedVersion), eq(periods.status, "open")))
      .returning({ id: periods.id });
    return updated.length === 1;
  }

  async transitionIfCurrent(period: ClosingPeriodRecord, expectedVersion: number, expectedStatus: ClosingPeriodRecord["status"]): Promise<boolean> {
    const updated = await this.db
      .update(periods)
      .set({ status: period.status, version: period.version, updatedAt: new Date(period.updatedAt) })
      .where(and(eq(periods.id, period.id), eq(periods.version, expectedVersion), eq(periods.status, expectedStatus)))
      .returning({ id: periods.id });
    return updated.length === 1;
  }
}
