import type { ClosingPeriodRecord } from "@platform/shared";

/** Persistência dos Closing Periods. */
export interface ClosingPeriodStore {
  list(): Promise<ClosingPeriodRecord[]>;
  get(id: string): Promise<ClosingPeriodRecord | null>;
  save(period: ClosingPeriodRecord): Promise<void>;
  delete(id: string): Promise<void>;
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
}
