import { z } from "zod";
import type { AuditService } from "./vinculo-audit.js";

export const PEDIDOS_PLUGIN = "inovafarma";
export const PEDIDO_TARGET = "pedido";
export const PEDIDOS_ACTIONS = { gerar: "pedido_create", editar: "pedido_update", cancelar: "pedido_cancel", finalizar: "pedido_finish" } as const;

const Atributos = z.object({ produtos: z.number().int() });

const produtos = (n: number) => `${n} ${n === 1 ? "produto" : "produtos"}`;

export function declarePedidosAudit(audit: AuditService): void {
  const base = { plugin: PEDIDOS_PLUGIN, schemaVersion: 1, schema: Atributos };
  audit.declareAction({ ...base, action: PEDIDOS_ACTIONS.gerar, summary: (a) => `Gerou o Pedido em rascunho com ${produtos(a.produtos)}.` });
  audit.declareAction({ ...base, action: PEDIDOS_ACTIONS.editar, summary: (a) => `Editou o Pedido em rascunho: ${produtos(a.produtos)}.` });
  audit.declareAction({ ...base, action: PEDIDOS_ACTIONS.cancelar, summary: () => "Cancelou o Pedido." });
  audit.declareAction({ ...base, action: PEDIDOS_ACTIONS.finalizar, summary: () => "Finalizou o Pedido." });
}
