import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { erps } from "./schema.js";
import type { ErpInput, ErpRecord, ErpStore } from "./erp-store.js";

type Row = typeof erps.$inferSelect;

function toRecord(row: Row): ErpRecord {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export class PostgresErpStore implements ErpStore {
  constructor(private db: NodePgDatabase) {}

  async list(): Promise<ErpRecord[]> {
    const rows = await this.db.select().from(erps).orderBy(erps.id);
    return rows.map(toRecord);
  }

  async get(id: string): Promise<ErpRecord | null> {
    const [row] = await this.db.select().from(erps).where(eq(erps.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async save(input: ErpInput): Promise<ErpRecord> {
    const [row] = await this.db
      .insert(erps)
      .values(input)
      .onConflictDoUpdate({ target: erps.id, set: { ...input, updatedAt: new Date() } })
      .returning();
    return toRecord(row!);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(erps).where(eq(erps.id, id));
  }
}
