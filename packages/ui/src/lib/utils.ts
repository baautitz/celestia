import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "YYYY-MM-DD" -> Date à meia-noite local (new Date("YYYY-MM-DD") seria UTC e recuaria um dia no Brasil). */
export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

/** Date local -> "YYYY-MM-DD" (toISOString converteria para UTC). */
export function toLocalISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
