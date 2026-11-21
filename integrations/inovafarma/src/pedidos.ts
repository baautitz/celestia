import { z } from "zod";
import { Codigo } from "./metas-comum.js";

/** Estados do Pedido: a Cotação leva o rascunho a cotado; a confirmação a confirmado; a conferência com a NF a parcialmente recebido e recebido. */
export const PEDIDO_STATUS = ["rascunho", "aguardando_precos", "cotado", "confirmado", "parcialmente_recebido", "recebido", "cancelado"] as const;
export type PedidoStatus = (typeof PEDIDO_STATUS)[number];

const MAX_QUANTIDADE = 1_000_000;

const QuantidadeLoja = z.object({ codigoLoja: Codigo, quantidade: z.number().int("A quantidade deve ser inteira.").min(0, "A quantidade não pode ser negativa.").max(MAX_QUANTIDADE, "Quantidade acima do limite.") });

const ItemPedido = z
  .object({
    produtoId: z.string().min(1).max(36),
    nome: z.string().min(1).max(200),
    codigoBarra: z.string().max(50).nullable(),
    quantidades: z.array(QuantidadeLoja).min(1, "Cada produto precisa de ao menos uma Loja."),
  })
  .refine((i) => new Set(i.quantidades.map((q) => q.codigoLoja)).size === i.quantidades.length, { error: "Loja repetida no mesmo produto.", path: ["quantidades"] });

export const DadosPedido = z
  .object({ itens: z.array(ItemPedido).min(1, "Escolha ao menos um produto.").max(500, "Produtos demais no Pedido.") })
  .refine((p) => new Set(p.itens.map((i) => i.produtoId)).size === p.itens.length, { error: "Produto repetido no Pedido.", path: ["itens"] });

export type DadosPedido = z.infer<typeof DadosPedido>;
export type ItemPedido = DadosPedido["itens"][number];

export interface Pedido extends DadosPedido {
  id: string;
  status: PedidoStatus;
  /** `produtoId` -> código do fornecedor escolhido; vazio até a confirmação. */
  escolhas: Record<string, number>;
  confirmadoEm: string | null;
  /** Referência lógica a `iam.users`. */
  criadoPorId: string;
  criadoPorNome: string;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}
