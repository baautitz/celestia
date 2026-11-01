import { z } from "zod";
import type { AuditService } from "./vinculo-audit.js";

export const FURO_ESTOQUE_PLUGIN = "inovafarma";
export const JUSTIFICATIVA_TARGET = "justificativa_ajuste";
export const MOTIVO_TARGET = "motivo_ajuste";
export const FURO_ESTOQUE_ACTIONS = {
  justificar: "justificativa_ajuste_create",
  editar: "justificativa_ajuste_update",
  excluir: "justificativa_ajuste_delete",
  criarMotivo: "motivo_ajuste_create",
  editarMotivo: "motivo_ajuste_update",
} as const;

const Valores = z.object({ motivo: z.string(), observacao: z.string().nullable() });
const AtributosJustificativa = Valores.extend({
  periodo: z.string(),
  codigoMovimento: z.number().int(),
  codigoLoja: z.number().int(),
  anterior: Valores.nullable(),
});
export type AtributosJustificativa = z.infer<typeof AtributosJustificativa>;

const ValoresMotivo = z.object({ nome: z.string(), ativo: z.boolean() });
const AtributosMotivo = ValoresMotivo.extend({ anterior: ValoresMotivo.nullable() });
export type AtributosMotivo = z.infer<typeof AtributosMotivo>;

const texto = (v: z.infer<typeof Valores>) => `"${v.motivo}"${v.observacao ? ` ("${v.observacao}")` : ""}`;
const ajuste = (a: AtributosJustificativa) => `o Ajuste de Estoque ${a.codigoMovimento} (Loja ${a.codigoLoja}) no período "${a.periodo}"`;
const motivo = (m: z.infer<typeof ValoresMotivo>) => `"${m.nome}"${m.ativo ? "" : " (inativo)"}`;

export function declareFuroEstoqueAudit(audit: AuditService): void {
  const justificativa = { plugin: FURO_ESTOQUE_PLUGIN, schemaVersion: 1, schema: AtributosJustificativa };
  audit.declareAction({ ...justificativa, action: FURO_ESTOQUE_ACTIONS.justificar, summary: (a) => `Justificou ${ajuste(a)} com ${texto(a)}.` });
  audit.declareAction({
    ...justificativa,
    action: FURO_ESTOQUE_ACTIONS.editar,
    summary: (a) => `Alterou a Justificativa d${ajuste(a)} de ${a.anterior ? texto(a.anterior) : "nenhuma"} para ${texto(a)}.`,
  });
  audit.declareAction({ ...justificativa, action: FURO_ESTOQUE_ACTIONS.excluir, summary: (a) => `Excluiu a Justificativa ${texto(a)} d${ajuste(a)}.` });

  const motivos = { plugin: FURO_ESTOQUE_PLUGIN, schemaVersion: 1, schema: AtributosMotivo };
  audit.declareAction({ ...motivos, action: FURO_ESTOQUE_ACTIONS.criarMotivo, summary: (a) => `Cadastrou o Motivo do Ajuste ${motivo(a)}.` });
  audit.declareAction({
    ...motivos,
    action: FURO_ESTOQUE_ACTIONS.editarMotivo,
    summary: (a) => `Alterou o Motivo do Ajuste de ${a.anterior ? motivo(a.anterior) : "?"} para ${motivo(a)}.`,
  });
}
