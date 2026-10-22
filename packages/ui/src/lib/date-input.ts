import { isValid, parse } from "date-fns";

const SINGLE_LENGTH = 10;

/** Aplica a máscara dd/MM/yyyy a medida que o usuário digita. */
export function maskDate(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Retorna a data só quando o texto está completo e é uma data real. */
export function parseDate(text: string): Date | undefined {
  if (text.length !== SINGLE_LENGTH) return undefined;
  const date = parse(text, "dd/MM/yyyy", new Date());
  return isValid(date) ? date : undefined;
}

/** Máscara de período: "dd/MM/yyyy - dd/MM/yyyy". */
export function maskDateRange(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 16);
  const from = maskDate(digits.slice(0, 8));
  if (digits.length <= 8) return from;
  return `${from} - ${maskDate(digits.slice(8))}`;
}

export function parseDateRange(text: string): { from: Date; to: Date } | undefined {
  const [fromText, toText, ...rest] = text.split(" - ");
  if (rest.length > 0 || fromText === undefined || toText === undefined) return undefined;
  const from = parseDate(fromText);
  const to = parseDate(toText);
  if (!from || !to || to < from) return undefined;
  return { from, to };
}
