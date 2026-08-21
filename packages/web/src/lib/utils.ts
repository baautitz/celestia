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
