/**
 * Motor de Baixas de Pré-vencido: função pura, sem I/O. Recebe o Estoque de uma Loja e as vendas do ERP feitas nela
 * e devolve as Baixas por venda e o Restante de cada Item.
 *
 * Datas (`incluidoEm` e `data`) vêm no mesmo formato comparável como texto, a hora do ERP `AAAA-MM-DD HH:MM:SS`.
 */

export interface ItemParaBaixa {
  id: string;
  /** Identificador opaco do produto. */
  produtoId: string;
  /** Mês e ano da validade, `AAAA-MM`. */
  validade: string;
  quantidade: number;
  /** Só as vendas a partir desta data gastam o Item. */
  incluidoEm: string;
}

/** Uma linha de venda do ERP: uma venda e um produto. */
export interface VendaParaBaixa {
  vendaId: number;
  data: string;
  /** Colaborador que fez a venda, quem recebe o crédito da Baixa. */
  codigoColaborador: number;
  produtoId: string;
  quantidade: number;
  /** Venda eliminada no ERP: não baixa. */
  cancelada: boolean;
}

/**
 * Estado congelado no fechamento de um Closing Period: as vendas até `ate` já estão contadas e cada Item parte do
 * Restante que tinha ali.
 */
export interface EstadoCongelado {
  /** Hora do ERP do fim do Período fechado: as vendas até aqui (inclusive) não baixam de novo. */
  ate: string;
  /** Restante de cada Item no congelamento, pelo id; o Item ausente (incluído depois) parte da quantidade. */
  restante: Record<string, number>;
}

/**
 * Entrada do motor. Pensada para crescer sem quebrar quem já chama: as Correções de Baixa (quantidade fixada de uma
 * linha de venda, identificada por `chaveDaLinha`) entram aqui como um campo novo.
 */
export interface EntradaBaixas<V extends VendaParaBaixa = VendaParaBaixa> {
  itens: readonly ItemParaBaixa[];
  vendas: readonly V[];
  /** Estado do último Closing Period fechado; sem ele, o motor parte das quantidades incluídas. */
  congelado?: EstadoCongelado | null;
}

export interface BaixaDeVenda<V extends VendaParaBaixa = VendaParaBaixa> {
  venda: V;
  /** Quanto da venda foi Pré-vencido. */
  quantidade: number;
  /** De quais Itens saiu, na ordem em que foram gastos. */
  itens: { itemId: string; quantidade: number }[];
}

export interface ResultadoBaixas<V extends VendaParaBaixa = VendaParaBaixa> {
  /** Só as vendas que baixaram algo, na ordem da data. */
  baixas: BaixaDeVenda<V>[];
  /** Restante de cada Item, pelo id. */
  restante: Record<string, number>;
}

/** Identifica a linha de venda (venda + produto), como a Correção de Baixa a referencia. */
export const chaveDaLinha = (venda: Pick<VendaParaBaixa, "vendaId" | "produtoId">) => `${venda.vendaId}|${venda.produtoId}`;

/** Ordem em que a prateleira entrega: validade mais próxima, depois o Item incluído antes. */
const ordemDeSaida = (a: ItemParaBaixa, b: ItemParaBaixa) => a.validade.localeCompare(b.validade) || a.incluidoEm.localeCompare(b.incluidoEm) || a.id.localeCompare(b.id);

export function calcularBaixas<V extends VendaParaBaixa>({ itens, vendas, congelado }: EntradaBaixas<V>): ResultadoBaixas<V> {
  const restante: Record<string, number> = Object.fromEntries(itens.map((i) => [i.id, congelado?.restante[i.id] ?? i.quantidade]));
  const porProduto = new Map<string, ItemParaBaixa[]>();
  for (const item of [...itens].sort(ordemDeSaida)) {
    porProduto.set(item.produtoId, [...(porProduto.get(item.produtoId) ?? []), item]);
  }

  const baixas: BaixaDeVenda<V>[] = [];
  const emOrdem = [...vendas].sort((a, b) => a.data.localeCompare(b.data) || a.vendaId - b.vendaId);
  for (const venda of emOrdem) {
    if (venda.cancelada || venda.quantidade <= 0 || (congelado && venda.data <= congelado.ate)) continue;
    let falta = venda.quantidade;
    const gastos: { itemId: string; quantidade: number }[] = [];
    for (const item of porProduto.get(venda.produtoId) ?? []) {
      if (falta <= 0) break;
      if (item.incluidoEm > venda.data || restante[item.id]! <= 0) continue;
      const gasto = Math.min(falta, restante[item.id]!);
      restante[item.id]! -= gasto;
      falta -= gasto;
      gastos.push({ itemId: item.id, quantidade: gasto });
    }
    if (gastos.length > 0) baixas.push({ venda, quantidade: venda.quantidade - falta, itens: gastos });
  }
  return { baixas, restante };
}
