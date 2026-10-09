import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { connections } from "../db/schema.js";
import type { ConnectionInput, ConnectionRecord, ConnectionStore } from "./connection-store.js";

type Row = typeof connections.$inferSelect;

function toRecord(row: Row): ConnectionRecord {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export class PostgresConnectionStore implements ConnectionStore {
  constructor(private db: NodePgDatabase) {}

  async list(): Promise<ConnectionRecord[]> {
    const rows = await this.db.select().from(connections).orderBy(connections.id);
    return rows.map(toRecord);
  }

  async get(id: string): Promise<ConnectionRecord | null> {
    const [row] = await this.db.select().from(connections).where(eq(connections.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async save(input: ConnectionInput): Promise<ConnectionRecord> {
    const [row] = await this.db
      .insert(connections)
      .values(input)
      .onConflictDoUpdate({ target: connections.id, set: { ...input, updatedAt: new Date() } })
      .returning();
    return toRecord(row!);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(connections).where(eq(connections.id, id));
  }
}
