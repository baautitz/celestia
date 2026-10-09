export interface ConnectionRecord {
  id: string;
  name: string;
  type: string;
  /** Valores públicos do formulário do tipo (sem segredos). */
  config: Record<string, unknown>;
  /** Campos do tipo "password", em JSON cifrado (AES-256-GCM). */
  secretsEncrypted: string;
  createdAt: string;
  updatedAt: string;
}

export type ConnectionInput = Omit<ConnectionRecord, "createdAt" | "updatedAt">;

export interface ConnectionStore {
  list(): Promise<ConnectionRecord[]>;
  get(id: string): Promise<ConnectionRecord | null>;
  save(input: ConnectionInput): Promise<ConnectionRecord>;
  delete(id: string): Promise<void>;
}

/**
 * Armazenamento de conexões em memória para testes no Vitest.
 */
export class MemoryConnectionStore implements ConnectionStore {
  private records = new Map<string, ConnectionRecord>();

  async list(): Promise<ConnectionRecord[]> {
    return Array.from(this.records.values());
  }

  async get(id: string): Promise<ConnectionRecord | null> {
    return this.records.get(id) ?? null;
  }

  async save(input: ConnectionInput): Promise<ConnectionRecord> {
    const now = new Date().toISOString();
    const record: ConnectionRecord = { ...input, createdAt: this.records.get(input.id)?.createdAt ?? now, updatedAt: now };
    this.records.set(input.id, record);
    return record;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}
