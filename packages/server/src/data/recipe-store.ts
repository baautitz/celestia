export interface RecipeRecord {
  id: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeStore {
  list(): Promise<RecipeRecord[]>;
  get(id: string): Promise<RecipeRecord | null>;
  save(id: string, source: string): Promise<RecipeRecord>;
  delete(id: string): Promise<void>;
}

/**
 * Armazenamento de Modelos em memória para testes no Vitest.
 */
export class MemoryRecipeStore implements RecipeStore {
  private records = new Map<string, RecipeRecord>();

  async list(): Promise<RecipeRecord[]> {
    return Array.from(this.records.values());
  }

  async get(id: string): Promise<RecipeRecord | null> {
    return this.records.get(id) ?? null;
  }

  async save(id: string, source: string): Promise<RecipeRecord> {
    const now = new Date().toISOString();
    const record: RecipeRecord = { id, source, createdAt: this.records.get(id)?.createdAt ?? now, updatedAt: now };
    this.records.set(id, record);
    return record;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}
