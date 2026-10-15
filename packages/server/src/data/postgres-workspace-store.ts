import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { workspaces } from "../db/schema.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { WorkspaceRecord } from "@platform/shared";

type Row = typeof workspaces.$inferSelect;

function toRecord(row: Row): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PostgresWorkspaceStore implements WorkspaceStore {
  constructor(private db: NodePgDatabase) {}

  async list(): Promise<WorkspaceRecord[]> {
    const rows = await this.db.select().from(workspaces).orderBy(workspaces.createdAt);
    return rows.map(toRecord);
  }

  async save(ws: WorkspaceRecord): Promise<void> {
    const values = {
      id: ws.id,
      name: ws.name,
      startDate: ws.startDate,
      endDate: ws.endDate,
      status: ws.status,
      createdAt: new Date(ws.createdAt),
      updatedAt: new Date(ws.updatedAt),
    };
    await this.db.insert(workspaces).values(values).onConflictDoUpdate({ target: workspaces.id, set: values });
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(workspaces).where(eq(workspaces.id, id));
  }
}
