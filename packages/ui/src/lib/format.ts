export function formatCurrency(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === "") return "R$ 0,00";
  const num = typeof value === "number" ? value : Number(value);
  if (isNaN(num)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}

export function formatNumber(value: number | string | undefined | null): string {
  const num = Number(value);
  if (value === undefined || value === null || value === "" || isNaN(num)) return "-";
  return new Intl.NumberFormat("pt-BR").format(num);
}

/** Valor monetário com duas casas e sem símbolo (ex.: 3388.3 vira "3.388,30"), para colunas com "(R$)" no rótulo. */
export function formatDecimal(value: number | string | undefined | null): string {
  const num = Number(value);
  if (value === undefined || value === null || value === "" || isNaN(num)) return "-";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

/** Recebe o valor já em pontos percentuais (ex.: 33.5 vira "33,5%"). */
export function formatPercent(value: number | string | undefined | null): string {
  const num = Number(value);
  if (value === undefined || value === null || value === "" || isNaN(num)) return "-";
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(num)}%`;
}

export function formatDate(dateString: string | Date | undefined | null): string {
  if (!dateString) return "-";
  try {
    if (typeof dateString === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      const [year, month, day] = dateString.split("-");
      return `${day}/${month}/${year}`;
    }
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return String(dateString);
    return new Intl.DateTimeFormat("pt-BR").format(date);
  } catch {
    return String(dateString);
  }
}
