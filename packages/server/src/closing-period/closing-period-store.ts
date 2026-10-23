import type { ClosingPeriodRecord } from "@platform/shared";

/** Persistência dos Closing Periods. */
export interface ClosingPeriodStore {
  list(): Promise<ClosingPeriodRecord[]>;
  get(id: string): Promise<ClosingPeriodRecord | null>;
  save(period: ClosingPeriodRecord): Promise<void>;
  delete(id: string): Promise<void>;
  /**
   * Grava `period` somente se a versão armazenada for `expectedVersion` e o período
   * estiver aberto (atômico). Retorna false quando nenhuma linha foi alterada.
   */
  updateIfCurrent(period: ClosingPeriodRecord, expectedVersion: number): Promise<boolean>;
  /**
   * Grava `period` (nova situação) somente se a versão armazenada for `expectedVersion` e a
   * situação armazenada for `expectedStatus` (atômico). Retorna false quando nenhuma linha foi alterada.
   */
  transitionIfCurrent(period: ClosingPeriodRecord, expectedVersion: number, expectedStatus: ClosingPeriodRecord["status"]): Promise<boolean>;
}

export class MemoryClosingPeriodStore implements ClosingPeriodStore {
  private readonly periods = new Map<string, ClosingPeriodRecord>();

  async list(): Promise<ClosingPeriodRecord[]> {
    return [...this.periods.values()];
  }

  async get(id: string): Promise<ClosingPeriodRecord | null> {
    return this.periods.get(id) ?? null;
  }

  async save(period: ClosingPeriodRecord): Promise<void> {
    this.periods.set(period.id, period);
  }

  async delete(id: string): Promise<void> {
    this.periods.delete(id);
  }

  async updateIfCurrent(period: ClosingPeriodRecord, expectedVersion: number): Promise<boolean> {
    const current = this.periods.get(period.id);
    if (!current || current.version !== expectedVersion || current.status !== "open") return false;
    this.periods.set(period.id, period);
    return true;
  }

  async transitionIfCurrent(period: ClosingPeriodRecord, expectedVersion: number, expectedStatus: ClosingPeriodRecord["status"]): Promise<boolean> {
    const current = this.periods.get(period.id);
    if (!current || current.version !== expectedVersion || current.status !== expectedStatus) return false;
    this.periods.set(period.id, period);
    return true;
  }
}
