import { z } from "zod";
import { reais } from "./indicadores.js";
import type { AuditService } from "./vinculo-audit.js";

export const APURACAO_PLUGIN = "inovafarma";
export const APURACAO_TARGET = "apuracao_metas";
export const APURACAO_ACTIONS = {
  congelar: "apuracao_metas_freeze",
  descartar: "apuracao_metas_discard",
} as const;

/**
 * `origem`: gravada no fechamento do Período, ou na primeira consulta de um Período fechado sem Apuração
 * (fechado antes das Metas, ou a gravação falhou depois do fechamento).
 */
const AtributosCongelamento = z.object({
  periodo: z.string(),
  origem: z.enum(["fechamento", "consulta"]),
  metas: z.number().int(),
  participantes: z.number().int(),
  premioCentavos: z.number().int(),
});
const AtributosDescarte = z.object({ periodo: z.string() });

export type AtributosCongelamento = z.infer<typeof AtributosCongelamento>;

const plural = (n: number, palavra: string) => `${n} ${palavra}${n === 1 ? "" : "s"}`;

export function declareApuracaoAudit(audit: AuditService): void {
  const base = { plugin: APURACAO_PLUGIN, schemaVersion: 1 };
  audit.declareAction({
    ...base,
    schema: AtributosCongelamento,
    action: APURACAO_ACTIONS.congelar,
    summary: (a) =>
      `${a.origem === "fechamento" ? "Gravou no fechamento" : "Gravou na primeira consulta após o fechamento"} a Apuração das Metas do período "${a.periodo}": ${plural(a.metas, "Meta")}, ${plural(a.participantes, "Participação")}, ${reais(a.premioCentavos)} em Prêmios.`,
  });
  audit.declareAction({
    ...base,
    schema: AtributosDescarte,
    action: APURACAO_ACTIONS.descartar,
    summary: (a) => `Descartou na reabertura a Apuração das Metas do período "${a.periodo}": o período volta a ser apurado ao vivo.`,
  });
}
