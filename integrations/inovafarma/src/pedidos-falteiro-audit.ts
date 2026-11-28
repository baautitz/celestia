import { z } from "zod";
import { PEDIDOS_PLUGIN } from "./pedidos-audit.js";
import type { AuditService } from "./vinculo-audit.js";

export const FALTEIRO_TARGET = "falteiro";
export const FALTEIRO_ACTIONS = {
  criar: "falteiro_create",
  editar: "falteiro_update",
  remover: "falteiro_delete",
} as const;

const Atributos = z.object({
  produto: z.string(),
  codigoLoja: z.number().int().nullable(),
  nomeLoja: z.string().nullable(),
  quantidade: z.number().int().nullable(),
  observacao: z.string().nullable(),
});
export type AtributosFalteiro = z.infer<typeof Atributos>;

const lojaTexto = (a: AtributosFalteiro) => (a.codigoLoja === null ? "todas as Lojas" : `a Loja "${a.nomeLoja ?? `cód. ${a.codigoLoja}`}"`);
const detalheTexto = (a: AtributosFalteiro) => {
  const partes = [a.quantidade !== null ? `qtde. ${a.quantidade}` : null, a.observacao ? `obs.: "${a.observacao}"` : null].filter(Boolean);
  return partes.length > 0 ? ` (${partes.join(", ")})` : "";
};

export function declareFalteiroAudit(audit: AuditService): void {
  const base = { plugin: PEDIDOS_PLUGIN, schemaVersion: 1, schema: Atributos };
  audit.declareAction({
    ...base,
    action: FALTEIRO_ACTIONS.criar,
    summary: (a) => `Registrou falta de "${a.produto}" para ${lojaTexto(a)}${detalheTexto(a)}.`,
  });
  audit.declareAction({
    ...base,
    action: FALTEIRO_ACTIONS.editar,
    summary: (a) => `Editou a falta de "${a.produto}" para ${lojaTexto(a)}${detalheTexto(a)}.`,
  });
  audit.declareAction({
    ...base,
    action: FALTEIRO_ACTIONS.remover,
    summary: (a) => `Removeu a falta de "${a.produto}" de ${lojaTexto(a)}.`,
  });
}
