import { z } from "zod";
import type { AuditService } from "./vinculo-audit.js";

export const PEDIDOS_MINIMOS_PLUGIN = "inovafarma";
export const PEDIDOS_MINIMOS_TARGET = "estoque_minimo";
export const PEDIDOS_MINIMOS_ACTION = "estoque_minimo_update";

const Valores = z.object({ minimo: z.number(), maximo: z.number().nullable() });
/** Produto e Loja já em texto: a entrada continua legível sem consultar o ERP. */
const Atributos = Valores.extend({ produto: z.string(), codigoLoja: z.number().int(), nomeLoja: z.string().nullable(), anterior: Valores.nullable() });

const texto = (v: z.infer<typeof Valores>) => `mínimo ${v.minimo}, máximo ${v.maximo ?? "não definido"}`;

export function declarePedidosMinimosAudit(audit: AuditService): void {
  audit.declareAction({
    plugin: PEDIDOS_MINIMOS_PLUGIN,
    action: PEDIDOS_MINIMOS_ACTION,
    schemaVersion: 1,
    schema: Atributos,
    summary: (a) => `Alterou o Estoque Mínimo de "${a.produto}" na Loja "${a.nomeLoja ?? `cód. ${a.codigoLoja}`}" de ${a.anterior ? texto(a.anterior) : "nenhum"} para ${texto(a)}.`,
  });
}
