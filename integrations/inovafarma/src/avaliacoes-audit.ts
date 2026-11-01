import { z } from "zod";
import type { AuditService } from "./vinculo-audit.js";

export const AVALIACAO_PLUGIN = "inovafarma";
export const AVALIACAO_TARGET = "avaliacao";
export const AVALIACAO_ACTIONS = { criar: "avaliacao_create", editar: "avaliacao_update", excluir: "avaliacao_delete" } as const;

const Atributos = z.object({
  periodo: z.string(),
  codigoColaborador: z.number().int(),
  nomeColaborador: z.string(),
  codigoLoja: z.number().int(),
  descricao: z.string(),
  valorCentavos: z.number().int(),
  anterior: z.object({ descricao: z.string(), valorCentavos: z.number().int() }).nullable(),
});
export type AtributosAvaliacao = z.infer<typeof Atributos>;

const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const descricao = (a: AtributosAvaliacao) => `Avaliação de ${a.nomeColaborador} no período "${a.periodo}" (${reais(a.valorCentavos)}): "${a.descricao}"`;

export function declareAvaliacaoAudit(audit: AuditService): void {
  const base = { plugin: AVALIACAO_PLUGIN, schemaVersion: 1, schema: Atributos };
  audit.declareAction({ ...base, action: AVALIACAO_ACTIONS.criar, summary: (a) => `Lançou ${descricao(a)}.` });
  audit.declareAction({
    ...base,
    action: AVALIACAO_ACTIONS.editar,
    summary: (a) => `Alterou a Avaliação de ${a.nomeColaborador} no período "${a.periodo}" de ${reais(a.anterior?.valorCentavos ?? 0)} ("${a.anterior?.descricao}") para ${reais(a.valorCentavos)} ("${a.descricao}").`,
  });
  audit.declareAction({ ...base, action: AVALIACAO_ACTIONS.excluir, summary: (a) => `Excluiu a ${descricao(a)}.` });
}
