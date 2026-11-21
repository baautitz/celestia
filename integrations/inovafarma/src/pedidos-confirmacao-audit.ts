import { z } from "zod";
import { PEDIDOS_PLUGIN } from "./pedidos-audit.js";
import type { AuditService } from "./vinculo-audit.js";

export const CONFIRMACAO_ACTIONS = { confirmar: "pedido_confirm", conferir: "pedido_check_invoice" } as const;

const STATUS_RECEBIMENTO = { confirmado: "confirmado", parcialmente_recebido: "parcialmente recebido", recebido: "recebido" } as const;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function declareConfirmacaoAudit(audit: AuditService): void {
  const base = { plugin: PEDIDOS_PLUGIN, schemaVersion: 1 };
  audit.declareAction({
    ...base,
    action: CONFIRMACAO_ACTIONS.confirmar,
    schema: z.object({ produtos: z.number().int(), fornecedores: z.number().int() }),
    summary: (a) => `Confirmou o Pedido: ${plural(a.produtos, "produto", "produtos")} em ${plural(a.fornecedores, "fornecedor", "fornecedores")}.`,
  });
  audit.declareAction({
    ...base,
    action: CONFIRMACAO_ACTIONS.conferir,
    schema: z.object({ status: z.enum(["confirmado", "parcialmente_recebido", "recebido"]) }),
    summary: (a) => `Conferiu o Pedido com a NF: ${STATUS_RECEBIMENTO[a.status]}.`,
  });
}
