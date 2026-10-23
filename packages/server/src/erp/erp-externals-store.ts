export type ErpExternalValues = Record<string, string | number>;

/** Externals de um usuário em um ERP; `userId` é o id do User do iam (referência sem FK entre Modules). */
export interface ErpExternalsStore {
  get(userId: string, erpId: string): Promise<ErpExternalValues>;
  save(userId: string, erpId: string, values: ErpExternalValues): Promise<void>;
  deleteByErp(erpId: string): Promise<void>;
}

export class MemoryErpExternalsStore implements ErpExternalsStore {
  private rows = new Map<string, ErpExternalValues>();
  private key = (userId: string, erpId: string) => `${erpId}\u0000${userId}`;

  async get(userId: string, erpId: string): Promise<ErpExternalValues> {
    return { ...(this.rows.get(this.key(userId, erpId)) ?? {}) };
  }

  async save(userId: string, erpId: string, values: ErpExternalValues): Promise<void> {
    this.rows.set(this.key(userId, erpId), { ...values });
  }

  async deleteByErp(erpId: string): Promise<void> {
    for (const k of [...this.rows.keys()]) if (k.startsWith(`${erpId}\u0000`)) this.rows.delete(k);
  }
}
