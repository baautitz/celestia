import { z } from "zod";
import type { AuditService } from "./vinculo-audit.js";

export const COTACAO_ACTIONS = { iniciar: "pedido_cotacao_start", importar: "pedido_cotacao_import" } as const;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function declareCotacaoAudit(audit: AuditService): void {
  const base = { plugin: "inovafarma", schemaVersion: 1 };
  audit.declareAction({
    ...base,
    action: COTACAO_ACTIONS.iniciar,
    schema: z.object({ fornecedores: z.number().int() }),
    summary: (a) => `Iniciou a cotação do Pedido com ${plural(a.fornecedores, "fornecedor", "fornecedores")}.`,
  });
  audit.declareAction({
    ...base,
    action: COTACAO_ACTIONS.importar,
    schema: z.object({ codigoFornecedor: z.number().int(), ofertas: z.number().int() }),
    summary: (a) => `Importou a planilha de preços do fornecedor ${a.codigoFornecedor}: ${plural(a.ofertas, "oferta", "ofertas")}.`,
  });
}
