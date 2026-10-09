import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { persistenceItems } from "../db/schema.js";
import type { PersistenceItem, PersistenceStore } from "./persistence-store.js";

type Row = typeof persistenceItems.$inferSelect;

function toItem(row: Row): PersistenceItem {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    collectionId: row.collectionId,
    targetForeignKey: row.targetForeignKey,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PostgresPersistenceStore implements PersistenceStore {
  constructor(private db: NodePgDatabase) {}

  async getItems(
    workspaceId: string,
    collectionId: string,
    targetForeignKey?: string | number
  ): Promise<PersistenceItem[]> {
    const rows = await this.db
      .select()
      .from(persistenceItems)
      .where(
        and(
          eq(persistenceItems.workspaceId, workspaceId),
          eq(persistenceItems.collectionId, collectionId),
          targetForeignKey !== undefined
            ? eq(persistenceItems.targetForeignKey, String(targetForeignKey))
            : undefined
        )
      )
      .orderBy(persistenceItems.createdAt);
    return rows.map(toItem);
  }

  async getScalar(
    workspaceId: string,
    collectionId: string,
    targetForeignKey: string | number
  ): Promise<Record<string, unknown> | null> {
    const [row] = await this.db
      .select()
      .from(persistenceItems)
      .where(this.keyFilter(workspaceId, collectionId, targetForeignKey))
      .limit(1);
    return row ? { ...row.data } : null;
  }

  async pushItem(
    workspaceId: string,
    collectionId: string,
    targetForeignKey: string | number,
    data: Record<string, unknown>
  ): Promise<PersistenceItem> {
    const [row] = await this.db
      .insert(persistenceItems)
      .values({ workspaceId, collectionId, targetForeignKey: String(targetForeignKey), data })
      .returning();
    return toItem(row!);
  }

  // ponytail: select-then-write; two concurrent first writes of the same key can duplicate, add a unique index for scalar collections if it matters
  async setScalar(
    workspaceId: string,
    collectionId: string,
    targetForeignKey: string | number,
    data: Record<string, unknown>
  ): Promise<PersistenceItem> {
    const filter = this.keyFilter(workspaceId, collectionId, targetForeignKey);
    const [existing] = await this.db.select().from(persistenceItems).where(filter).limit(1);
    if (!existing) {
      return this.pushItem(workspaceId, collectionId, targetForeignKey, data);
    }
    const [row] = await this.db
      .update(persistenceItems)
      .set({ data: { ...existing.data, ...data }, updatedAt: new Date() })
      .where(eq(persistenceItems.id, existing.id))
      .returning();
    return toItem(row!);
  }

  async deleteItem(workspaceId: string, collectionId: string, itemId: string | number): Promise<void> {
    await this.db
      .delete(persistenceItems)
      .where(
        and(
          eq(persistenceItems.workspaceId, workspaceId),
          eq(persistenceItems.collectionId, collectionId),
          sql`${persistenceItems.id}::text = ${String(itemId)}`
        )
      );
  }

  async clear(workspaceId?: string): Promise<void> {
    await this.db
      .delete(persistenceItems)
      .where(workspaceId ? eq(persistenceItems.workspaceId, workspaceId) : undefined);
  }

  private keyFilter(workspaceId: string, collectionId: string, targetForeignKey: string | number) {
    return and(
      eq(persistenceItems.workspaceId, workspaceId),
      eq(persistenceItems.collectionId, collectionId),
      eq(persistenceItems.targetForeignKey, String(targetForeignKey))
    );
  }
}
