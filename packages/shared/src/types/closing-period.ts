/** Estados de um Closing Period (Período de Fechamento). */
export type ClosingPeriodStatus = "open" | "closed";

/**
 * Closing Period: faixa contínua de datas (inclusive) de qualquer duração.
 * Uma data pertence a no máximo um Closing Period, aberto ou fechado.
 */
export interface ClosingPeriodRecord {
  id: string;
  name: string;
  startDate: string; // Formato AAAA-MM-DD
  endDate: string; // Formato AAAA-MM-DD
  status: ClosingPeriodStatus;
  /** Controle de concorrência otimista: começa em 1 e sobe a cada alteração. */
  version: number;
  createdAt: string;
  updatedAt: string;
}
