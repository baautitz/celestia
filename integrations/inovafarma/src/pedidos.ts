import { z } from "zod";
import { Codigo } from "./metas-comum.js";

/** Estados do Pedido: a Cotação leva o rascunho a cotado; a confirmação a confirmado; a conferência com a NF a parcialmente recebido e recebido. */
export const PEDIDO_STATUS = ["rascunho", "aguardando_precos", "cotado", "confirmado", "parcialmente_recebido", "recebido", "cancelado"] as const;
export type PedidoStatus = (typeof PEDIDO_STATUS)[number];

const MAX_QUANTIDADE = 1_000_000;

/** Quanto da linha outra Loja fornece, por transferência. */
const ParteDeLoja = z.object({ codigoLoja: Codigo, quantidade: z.number().int("A quantidade deve ser inteira.").positive("Informe quanto vem de cada Loja.").max(MAX_QUANTIDADE, "Quantidade acima do limite.") });

/** Quanto se quer de uma distribuidora já no Lançamento; sem isso ela cota o restante. */
const ParteDeDistribuidora = z.object({ codigoFornecedor: Codigo, quantidade: z.number().int("A quantidade deve ser inteira.").positive().max(MAX_QUANTIDADE, "Quantidade acima do limite.") });

const QuantidadeLoja = z.object({ quantidadesDistribuidoras: z.array(ParteDeDistribuidora).max(30).optional(),  codigoLoja: Codigo, quantidade: z.number().int("A quantidade deve ser inteira.").min(0, "A quantidade não pode ser negativa.").max(MAX_QUANTIDADE, "Quantidade acima do limite."), codigosFornecedor: z.array(Codigo).max(30, "Distribuidoras demais na linha.").optional(), lojasFornecedoras: z.array(ParteDeLoja).max(30, "Lojas demais na linha.").optional() })
  .refine((q) => (q.lojasFornecedoras ?? []).reduce((t, l) => t + l.quantidade, 0) <= q.quantidade, { error: "As Lojas fornecem mais do que o pedido na linha.", path: ["lojasFornecedoras"] })
  .refine((q) => !q.quantidadesDistribuidoras?.some((d) => !q.codigosFornecedor?.includes(d.codigoFornecedor)), { error: "Quantidade de distribuidora que não está na linha.", path: ["quantidadesDistribuidoras"] })
  .refine((q) => [...(q.lojasFornecedoras ?? []), ...(q.quantidadesDistribuidoras ?? [])].reduce((t, p) => t + p.quantidade, 0) <= q.quantidade, { error: "Os fornecedores somam mais do que o pedido na linha.", path: ["quantidadesDistribuidoras"] })
  .refine((q) => !q.lojasFornecedoras?.some((l) => l.codigoLoja === q.codigoLoja), { error: "A Loja não pode fornecer para ela mesma.", path: ["lojasFornecedoras"] })
  .refine((q) => new Set(q.lojasFornecedoras?.map((l) => l.codigoLoja)).size === (q.lojasFornecedoras?.length ?? 0), { error: "Loja fornecedora repetida na linha.", path: ["lojasFornecedoras"] });

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

/** Quanto uma distribuidora manda para uma Loja, no produto dividido entre fornecedores. */
export interface Parcela {
  codigoLoja: number;
  codigoFornecedor: number;
  quantidade: number;
}
/** O produto inteiro com uma distribuidora (o código) ou dividido por Loja e distribuidora. */
export type Escolha = number | Parcela[];
export type Escolhas = Record<string, Escolha>;

/** As distribuidoras de uma escolha. */
export const fornecedoresDa = (escolha: Escolha | undefined): number[] => (escolha === undefined ? [] : typeof escolha === "number" ? [escolha] : [...new Set(escolha.map((p) => p.codigoFornecedor))]);

type Linha = DadosPedido["itens"][number]["quantidades"][number];
/** O que as outras Lojas fornecem da linha, e o que sobra para as distribuidoras. */
export const deLojas = (q: Linha) => (q.lojasFornecedoras ?? []).reduce((t, l) => t + l.quantidade, 0);
export const paraCotar = (q: Linha) => q.quantidade - deLojas(q);

export interface Pedido extends DadosPedido {
  id: string;
  status: PedidoStatus;
  /** `produtoId` -> a escolha da cotação; vazio até a confirmação. */
  escolhas: Escolhas;
  confirmadoEm: string | null;
  /** Referência lógica a `iam.users`. */
  criadoPorId: string;
  criadoPorNome: string;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

/** O que a linha pede à distribuidora: a quantidade definida para ela ou o que sobra depois das Lojas e das definidas. */
export function pedidaAoFornecedor(q: Linha, codigoFornecedor: number): number {
  const definidas = q.quantidadesDistribuidoras ?? [];
  return definidas.find((d) => d.codigoFornecedor === codigoFornecedor)?.quantidade ?? Math.max(0, paraCotar(q) - definidas.reduce((t, d) => t + d.quantidade, 0));
}

/** O Pedido só com o que vai para cotação e conta como compra: sem a parte que as outras Lojas fornecem. */
export function semLinhasDeLoja<P extends Pick<Pedido, "itens">>(pedido: P): P {
  const aCotar = (quantidades: Linha[]) =>
    quantidades.flatMap((q) => {
      const { lojasFornecedoras, ...resto } = q;
      if (!lojasFornecedoras?.length) return [resto];
      return paraCotar(q) > 0 ? [{ ...resto, quantidade: paraCotar(q) }] : [];
    });
  return { ...pedido, itens: pedido.itens.map((i) => ({ ...i, quantidades: aCotar(i.quantidades) })).filter((i) => i.quantidades.length > 0) };
}

/** Tudo o que se pede vem de outras Lojas: não há o que cotar. */
export const soDeLojas = (pedido: Pick<Pedido, "itens">) => pedido.itens.every((i) => i.quantidades.every((q) => paraCotar(q) === 0));
