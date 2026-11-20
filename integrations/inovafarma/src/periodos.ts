import { formatDate } from "@platform/ui/lib/format";

/** Período de Fechamento como o servidor o entrega às telas do Plugin. */
export interface Periodo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "open" | "closed";
}

export const periodoLabel = (p: Periodo) => `${p.name} (${formatDate(p.startDate)} a ${formatDate(p.endDate)})${p.status === "closed" ? " · Fechado" : ""}`;

/** O período aberto de data mais recente; sem nenhum aberto, o mais recente. */
export const periodoInicial = (periodos: Periodo[]) => (periodos.find((p) => p.status !== "closed") ?? periodos[0])?.id ?? "";
