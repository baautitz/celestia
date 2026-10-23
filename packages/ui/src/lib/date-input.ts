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

export const INVALID_DATE_MESSAGE = "Data inválida. Use dd/mm/aaaa.";
export const INVALID_RANGE_MESSAGE = "Período inválido. Use dd/mm/aaaa - dd/mm/aaaa, com a data final igual ou posterior à inicial.";

const RANGE_LENGTH = 23;

/** Mensagem de erro do texto digitado; só aparece com o texto completo ou depois de sair do campo. */
export function dateTextError(text: string, touched: boolean): string | undefined {
  if (text === "" || parseDate(text) || !(touched || text.length === SINGLE_LENGTH)) return undefined;
  return INVALID_DATE_MESSAGE;
}

export function dateRangeTextError(text: string, touched: boolean): string | undefined {
  if (text === "" || parseDateRange(text) || !(touched || text.length === RANGE_LENGTH)) return undefined;
  return INVALID_RANGE_MESSAGE;
}

export function parseDateRange(text: string): { from: Date; to: Date } | undefined {
  const [fromText, toText, ...rest] = text.split(" - ");
  if (rest.length > 0 || fromText === undefined || toText === undefined) return undefined;
  const from = parseDate(fromText);
  const to = parseDate(toText);
  if (!from || !to || to < from) return undefined;
  return { from, to };
}
