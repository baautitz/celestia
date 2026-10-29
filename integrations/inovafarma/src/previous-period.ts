/** Campos do Período de Fechamento usados para achar o anterior. */
export interface PeriodRange {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "open" | "closed" | "cancelled";
}

const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/**
 * Faixa de comparação do `selected`: o Período não cancelado que termina mais perto antes do seu início.
 * Se o `selected` ainda não terminou em `today`, o anterior é cortado nos mesmos dias decorridos,
 * para não comparar um período parcial com um inteiro. Datas em `YYYY-MM-DD`.
 */
export function previousPeriodRange(
  periods: PeriodRange[],
  selected: PeriodRange,
  today: string,
): { name: string; startDate: string; endDate: string } | undefined {
  const previous = periods
    .filter((p) => p.status !== "cancelled" && p.endDate < selected.startDate)
    .reduce<PeriodRange | undefined>((latest, p) => (!latest || p.endDate > latest.endDate ? p : latest), undefined);
  if (!previous) return undefined;
  if (selected.endDate <= today) return { name: previous.name, startDate: previous.startDate, endDate: previous.endDate };

  const elapsed = toTime(today) - toTime(selected.startDate);
  if (elapsed < 0) return undefined;
  const endDate = toDate(Math.min(toTime(previous.startDate) + elapsed, toTime(previous.endDate)));
  return { name: previous.name, startDate: previous.startDate, endDate };
}
