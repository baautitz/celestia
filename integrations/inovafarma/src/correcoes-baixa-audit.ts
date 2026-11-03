import { z } from "zod";
import type { AuditService } from "./vinculo-audit.js";

export const CORRECAO_BAIXA_PLUGIN = "inovafarma";
export const CORRECAO_BAIXA_TARGET = "correcao_baixa";
export const CORRECAO_BAIXA_ACTIONS = { criar: "correcao_baixa_create", editar: "correcao_baixa_update", excluir: "correcao_baixa_delete" } as const;

/**
 * Antes e depois são a Baixa da venda (quanto dela foi Pré-vencido) com o motivo da Correção, quando havia: ao criar, o
 * antes é a Baixa calculada; ao alterar ou desfazer, a Correção anterior. O código do produto no ERP não entra.
 */
const Atributos = z.object({
  codigoLoja: z.number().int(),
  vendaId: z.number().int(),
  nomeProduto: z.string(),
  nomeColaborador: z.string(),
  quantidadeVendida: z.number(),
  antes: z.object({ quantidade: z.number(), motivo: z.string().optional() }),
  /** Null ao desfazer: a venda volta a baixar pelo cálculo. */
  depois: z.object({ quantidade: z.number(), motivo: z.string() }).nullable(),
});
export type AtributosCorrecaoBaixa = z.infer<typeof Atributos>;

const linha = (a: AtributosCorrecaoBaixa) => `a Baixa da venda ${a.vendaId} de "${a.nomeProduto}" (${a.nomeColaborador}, Loja ${a.codigoLoja})`;
const motivoAnterior = (a: AtributosCorrecaoBaixa) => (a.antes.motivo ? ` (antes: ${a.antes.motivo})` : "");

export function declareCorrecaoBaixaAudit(audit: AuditService): void {
  const base = { plugin: CORRECAO_BAIXA_PLUGIN, schemaVersion: 1, schema: Atributos };
  audit.declareAction({ ...base, action: CORRECAO_BAIXA_ACTIONS.criar, summary: (a) => `Corrigiu ${linha(a)} de ${a.antes.quantidade} para ${a.depois?.quantidade} un. Motivo: ${a.depois?.motivo}` });
  audit.declareAction({
    ...base,
    action: CORRECAO_BAIXA_ACTIONS.editar,
    summary: (a) => `Alterou a Correção d${linha(a).slice(1)} de ${a.antes.quantidade} para ${a.depois?.quantidade} un. Motivo: ${a.depois?.motivo}${motivoAnterior(a)}`,
  });
  audit.declareAction({ ...base, action: CORRECAO_BAIXA_ACTIONS.excluir, summary: (a) => `Desfez a Correção d${linha(a).slice(1)} (era ${a.antes.quantidade} un. Motivo: ${a.antes.motivo}).` });
}
