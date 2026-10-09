import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { recipes } from "../db/schema.js";
import type { RecipeRecord, RecipeStore } from "./recipe-store.js";

type Row = typeof recipes.$inferSelect;

function toRecord(row: Row): RecipeRecord {
  return {
    id: row.id,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PostgresRecipeStore implements RecipeStore {
  constructor(private db: NodePgDatabase) {}

  async list(): Promise<RecipeRecord[]> {
    const rows = await this.db.select().from(recipes).orderBy(recipes.id);
    return rows.map(toRecord);
  }

  async get(id: string): Promise<RecipeRecord | null> {
    const [row] = await this.db.select().from(recipes).where(eq(recipes.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async save(id: string, source: string): Promise<RecipeRecord> {
    const [row] = await this.db
      .insert(recipes)
      .values({ id, source })
      .onConflictDoUpdate({ target: recipes.id, set: { source, updatedAt: new Date() } })
      .returning();
    return toRecord(row!);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(recipes).where(eq(recipes.id, id));
  }
}
