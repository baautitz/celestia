import { z } from "zod";
import { horaDoErp } from "./baixas-da-loja.js";
import type { AuditService } from "./vinculo-audit.js";

export const ITEM_PRE_VENCIDO_PLUGIN = "inovafarma";
export const ITEM_PRE_VENCIDO_TARGET = "item_pre_vencido";
export const ITEM_PRE_VENCIDO_ACTIONS = { criar: "item_pre_vencido_create", editar: "item_pre_vencido_update", excluir: "item_pre_vencido_delete" } as const;

/** Só nome e código de barras identificam o produto: o código do ERP não entra no Audit Log. */
const Atributos = z.object({
  codigoLoja: z.number().int(),
  nomeLoja: z.string(),
  nomeProduto: z.string(),
  codigoBarra: z.string().nullable(),
  quantidade: z.number().int(),
  validade: z.string(),
  incluidoEm: z.string(),
  /** `incluidoEm` só quando a edição mudou a data de inclusão. */
  anterior: z.object({ quantidade: z.number().int(), validade: z.string(), incluidoEm: z.string().optional() }).nullable(),
});
export type AtributosItemPreVencido = z.infer<typeof Atributos>;

/** Dia (na hora do ERP) de um instante ISO, `DD/MM/AAAA`. */
const dataBr = (iso: string) => horaDoErp(iso).slice(0, 10).split("-").reverse().join("/");
const loja = (a: AtributosItemPreVencido) => a.nomeLoja || `Loja ${a.codigoLoja}`;
const descricao = (a: AtributosItemPreVencido) => `${a.quantidade} un. de "${a.nomeProduto}" (validade ${a.validade}) no Estoque de Pré-vencidos da ${loja(a)}`;

export function declareItemPreVencidoAudit(audit: AuditService): void {
  const base = { plugin: ITEM_PRE_VENCIDO_PLUGIN, schemaVersion: 1, schema: Atributos };
  audit.declareAction({ ...base, action: ITEM_PRE_VENCIDO_ACTIONS.criar, summary: (a) => `Incluiu ${descricao(a)}.` });
  audit.declareAction({
    ...base,
    action: ITEM_PRE_VENCIDO_ACTIONS.editar,
    summary: (a) =>
      `Alterou o Item de Pré-vencido "${a.nomeProduto}" da ${loja(a)} de ${a.anterior?.quantidade} un. (validade ${a.anterior?.validade}) para ${a.quantidade} un. (validade ${a.validade}).${a.anterior?.incluidoEm ? ` Data de inclusão de ${dataBr(a.anterior.incluidoEm)} para ${dataBr(a.incluidoEm)}.` : ""}`,
  });
  audit.declareAction({ ...base, action: ITEM_PRE_VENCIDO_ACTIONS.excluir, summary: (a) => `Excluiu ${descricao(a)}.` });
}
