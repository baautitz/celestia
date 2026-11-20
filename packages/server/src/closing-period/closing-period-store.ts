import type { ClosingPeriodRecord } from "@platform/shared";

/** A faixa gravada coincidiria com a de outro período (uma data pertence a no máximo um Closing Period). */
export class PeriodOverlapError extends Error {
  constructor() {
    super("A faixa coincide com a de outro Período de Fechamento.");
  }
}

/** Duas faixas inclusivas compartilham ao menos uma data. */
export const rangesOverlap = (a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }): boolean =>
  a.startDate <= b.endDate && b.startDate <= a.endDate;

/** Persistência dos Closing Periods. */
export interface ClosingPeriodStore {
  list(): Promise<ClosingPeriodRecord[]>;
  get(id: string): Promise<ClosingPeriodRecord | null>;
  /** Grava (upsert). Lança `PeriodOverlapError` se a faixa coincidir com a de outro período. */
  save(period: ClosingPeriodRecord): Promise<void>;
  delete(id: string): Promise<void>;
  /**
   * Remove o período somente se a versão armazenada for `expectedVersion` e a situação for `expectedStatus`
   * (atômico). Retorna false quando nenhuma linha foi removida.
   */
  deleteIfCurrent(id: string, expectedVersion: number, expectedStatus: ClosingPeriodRecord["status"]): Promise<boolean>;
  /**
   * Grava `period` somente se a versão armazenada for `expectedVersion` e o período
   * estiver aberto (atômico). Retorna false quando nenhuma linha foi alterada.
   * Lança `PeriodOverlapError` se a nova faixa coincidir com a de outro período.
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

  private assertNoOverlap(period: ClosingPeriodRecord): void {
    for (const other of this.periods.values()) {
      if (other.id !== period.id && rangesOverlap(other, period)) throw new PeriodOverlapError();
    }
  }

  async save(period: ClosingPeriodRecord): Promise<void> {
    this.assertNoOverlap(period);
    this.periods.set(period.id, period);
  }

  async delete(id: string): Promise<void> {
    this.periods.delete(id);
  }

  async deleteIfCurrent(id: string, expectedVersion: number, expectedStatus: ClosingPeriodRecord["status"]): Promise<boolean> {
    const current = this.periods.get(id);
    if (!current || current.version !== expectedVersion || current.status !== expectedStatus) return false;
    this.periods.delete(id);
    return true;
  }

  async updateIfCurrent(period: ClosingPeriodRecord, expectedVersion: number): Promise<boolean> {
    const current = this.periods.get(period.id);
    if (!current || current.version !== expectedVersion || current.status !== "open") return false;
    this.assertNoOverlap(period);
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
