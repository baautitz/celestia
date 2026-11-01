import { z } from "zod";
import type { AuditService } from "./vinculo-audit.js";

export const PRE_VENCIDO_PLUGIN = "inovafarma";
export const PRE_VENCIDO_TARGET = "pre_vencido";
export const PRE_VENCIDO_ACTIONS = { criar: "pre_vencido_create", editar: "pre_vencido_update", excluir: "pre_vencido_delete" } as const;

/** Só nome e código de barras identificam o produto: o código do ERP não entra no Audit Log. */
const Atributos = z.object({
  periodo: z.string(),
  codigoColaborador: z.number().int(),
  nomeColaborador: z.string(),
  nomeProduto: z.string(),
  codigoBarra: z.string().nullable(),
  codigoLoja: z.number().int(),
  quantidade: z.number().int(),
  validade: z.string(),
  anterior: z.object({ quantidade: z.number().int(), validade: z.string() }).nullable(),
});
export type AtributosPreVencido = z.infer<typeof Atributos>;

const descricao = (a: AtributosPreVencido) => `${a.quantidade} un. de "${a.nomeProduto}" (validade ${a.validade}) de ${a.nomeColaborador} no período "${a.periodo}"`;

export function declarePreVencidoAudit(audit: AuditService): void {
  const base = { plugin: PRE_VENCIDO_PLUGIN, schemaVersion: 1, schema: Atributos };
  audit.declareAction({ ...base, action: PRE_VENCIDO_ACTIONS.criar, summary: (a) => `Lançou ${descricao(a)}.` });
  audit.declareAction({
    ...base,
    action: PRE_VENCIDO_ACTIONS.editar,
    summary: (a) => `Alterou o lançamento de "${a.nomeProduto}" de ${a.nomeColaborador} no período "${a.periodo}" de ${a.anterior?.quantidade} un. (validade ${a.anterior?.validade}) para ${a.quantidade} un. (validade ${a.validade}).`,
  });
  audit.declareAction({ ...base, action: PRE_VENCIDO_ACTIONS.excluir, summary: (a) => `Excluiu o lançamento de ${descricao(a)}.` });
}
