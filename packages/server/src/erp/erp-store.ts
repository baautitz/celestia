export interface ErpRecord {
  id: string;
  name: string;
  /** Id do ERP Driver (ex.: "mssql"). */
  driver: string;
  /** Valores públicos do formulário do driver (sem segredos). */
  config: Record<string, unknown>;
  /** Campos do tipo "password", em JSON cifrado (AES-256-GCM). */
  secretsEncrypted: string;
  createdAt: string;
  updatedAt: string;
}

export type ErpInput = Omit<ErpRecord, "createdAt" | "updatedAt">;

export interface ErpStore {
  list(): Promise<ErpRecord[]>;
  get(id: string): Promise<ErpRecord | null>;
  save(input: ErpInput): Promise<ErpRecord>;
  delete(id: string): Promise<void>;
}

/**
 * Armazenamento de ERPs em memória para testes no Vitest.
 */
export class MemoryErpStore implements ErpStore {
  private records = new Map<string, ErpRecord>();

  async list(): Promise<ErpRecord[]> {
    return Array.from(this.records.values());
  }

  async get(id: string): Promise<ErpRecord | null> {
    return this.records.get(id) ?? null;
  }

  async save(input: ErpInput): Promise<ErpRecord> {
    const now = new Date().toISOString();
    const record: ErpRecord = { ...input, createdAt: this.records.get(input.id)?.createdAt ?? now, updatedAt: now };
    this.records.set(input.id, record);
    return record;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}
