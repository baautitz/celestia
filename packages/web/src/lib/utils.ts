import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === "") return "R$ 0,00"
  const num = typeof value === "number" ? value : Number(value)
  if (isNaN(num)) return "R$ 0,00"
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num)
}

export function formatNumber(value: number | string | undefined | null): string {
  const num = Number(value)
  if (value === undefined || value === null || value === "" || isNaN(num)) return "-"
  return new Intl.NumberFormat("pt-BR").format(num)
}

/** Recebe o valor já em pontos percentuais (ex.: 33.5 vira "33,5%"). */
export function formatPercent(value: number | string | undefined | null): string {
  const num = Number(value)
  if (value === undefined || value === null || value === "" || isNaN(num)) return "-"
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(num)}%`
}

/** Número em notação compacta pt-BR (ex.: 12,3 mil), para eixos de gráfico. */
export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

/** "2026-09-03" vira "03/09"; qualquer outro texto é devolvido como está. */
export function formatShortDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : value
}

export function formatDate(dateString: string | Date | undefined | null): string {
  if (!dateString) return "-"
  try {
    if (typeof dateString === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      const [year, month, day] = dateString.split("-")
      return `${day}/${month}/${year}`
    }
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return String(dateString)
    return new Intl.DateTimeFormat("pt-BR").format(date)
  } catch {
    return String(dateString)
  }
}

/** Data e hora no fuso local: "09/10/2026 03:56". */
export function formatDateTime(value: string | Date | undefined | null): string {
  if (!value) return "-"
  const date = new Date(value)
  if (isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date)
}

export { parseLocalDate, toLocalISODate } from "@platform/ui/lib/utils";

/** Baixa o código-fonte de um Dashboard como `<id>.ts`. */
export function downloadSource(id: string, source: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${id}.ts`;
  link.click();
  URL.revokeObjectURL(url);
}
