import { z } from "zod";
import type { AuditService } from "./vinculo-audit.js";

export const BAIXAS_CONGELADAS_PLUGIN = "inovafarma";
export const BAIXAS_CONGELADAS_TARGET = "baixas_congeladas";
export const BAIXAS_CONGELADAS_ACTIONS = { descartar: "baixas_congeladas_discard" } as const;

/** O que a reabertura descartou: as Baixas gravadas no fechamento, e o Restante dos Itens, em quantas Lojas. */
const AtributosDescarte = z.object({ periodo: z.string(), lojas: z.number().int(), baixas: z.number().int() });
export type AtributosDescarteBaixas = z.infer<typeof AtributosDescarte>;

const plural = (n: number, palavra: string) => `${n} ${palavra}${n === 1 ? "" : "s"}`;

export function declareBaixasCongeladasAudit(audit: AuditService): void {
  audit.declareAction({
    plugin: BAIXAS_CONGELADAS_PLUGIN,
    schemaVersion: 1,
    schema: AtributosDescarte,
    action: BAIXAS_CONGELADAS_ACTIONS.descartar,
    summary: (a) =>
      `Descartou na reabertura as Baixas de Pré-vencido gravadas no fechamento do período "${a.periodo}" (${plural(a.baixas, "Baixa")} em ${plural(a.lojas, "Loja")}): o período volta a ser calculado ao vivo.`,
  });
}
