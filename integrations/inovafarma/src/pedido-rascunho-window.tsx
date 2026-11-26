import { API } from "./inovafarma-api";

export const PEDIDOS_BASE = `${API}/pedidos/pedidos`;

export interface ItemPedido {
  produtoId: string;
  nome: string;
  codigoBarra: string | null;
  quantidades: { codigoLoja: number; quantidade: number; /** Distribuidoras escolhidas na grade de Lojas (a Cotação abre com elas marcadas). */ codigosFornecedor?: number[]; quantidadesDistribuidoras?: { codigoFornecedor: number; quantidade: number }[]; /** Quanto outras Lojas fornecem, por transferência. */ lojasFornecedoras?: { codigoLoja: number; quantidade: number }[] }[];
}

export interface Pedido {
  id: string;
  status: "rascunho" | "aguardando_precos" | "cotado" | "confirmado" | "parcialmente_recebido" | "recebido" | "finalizado" | "cancelado";
  itens: ItemPedido[];
  /** A escolha da cotação por produto; vazia até a confirmação. */
  escolhas?: Record<string, number | { codigoLoja: number; codigoFornecedor: number; quantidade: number }[]>;
  criadoPorNome: string;
  version: number;
  criadoEm: string;
}
