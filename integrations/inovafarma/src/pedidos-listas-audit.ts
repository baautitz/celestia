import { z } from "zod";
import { PEDIDOS_PLUGIN } from "./pedidos-audit.js";
import type { AuditService } from "./vinculo-audit.js";

export const PEDIDO_LISTA_TARGET = "pedido_lista_produtos";
export const PEDIDOS_LISTAS_ACTIONS = {
  criar: "pedido_lista_create",
  editar: "pedido_lista_update",
  remover: "pedido_lista_delete",
} as const;

/** Nome e conteúdo já em texto: a entrada continua legível se a lista ou o cadastro do ERP mudar. */
const Valores = z.object({ nome: z.string(), conteudo: z.string() });
const Atributos = Valores.extend({ anterior: Valores.nullable() });
export type ValoresListaPedidos = z.infer<typeof Valores>;

const nome = (a: ValoresListaPedidos) => `"${a.nome}"`;

export function declarePedidosListasAudit(audit: AuditService): void {
  const base = { plugin: PEDIDOS_PLUGIN, schemaVersion: 1, schema: Atributos };
  audit.declareAction({ ...base, action: PEDIDOS_LISTAS_ACTIONS.criar, summary: (a) => `Criou a lista de produtos ${nome(a)} de Pedidos: ${a.conteudo}.` });
  audit.declareAction({
    ...base,
    action: PEDIDOS_LISTAS_ACTIONS.editar,
    summary: (a) => {
      const partes = [a.anterior && a.anterior.nome !== a.nome ? `nome de "${a.anterior.nome}" para "${a.nome}"` : null, a.anterior?.conteudo !== a.conteudo ? `conteúdo de ${a.anterior?.conteudo} para ${a.conteudo}` : null];
      return `Alterou a lista de produtos ${nome(a)} de Pedidos: ${partes.filter(Boolean).join("; ") || "sem mudanças"}.`;
    },
  });
  audit.declareAction({ ...base, action: PEDIDOS_LISTAS_ACTIONS.remover, summary: (a) => `Removeu a lista de produtos ${nome(a)} de Pedidos (${a.conteudo}).` });
}
