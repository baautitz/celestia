import { baixasDaLoja, type VendaDaLoja } from "./baixas-da-loja.js";
import type { EstoquePreVencidoStore } from "./estoque-pre-vencidos-store.js";
import { SEM_CONEXAO } from "./metas-comum.js";

interface ErpQuery {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
}

/** Closing Period das Baixas: as datas (`AAAA-MM-DD`) limitam as vendas que contam. */
export interface PeriodoDasBaixas {
  id: string;
  startDate: string;
  endDate: string;
}

/** Uma Baixa de Pré-vencido de um Closing Period: a venda, a Loja e o produto, como a aba Baixas e o Indicador usam. */
export interface BaixaDoPeriodo {
  codigoLoja: number;
  venda: VendaDaLoja;
  /** Quanto da venda foi Pré-vencido. */
  quantidade: number;
  nomeProduto: string;
  codigoBarra: string | null;
}

export interface BaixasDoPeriodoDeps {
  erpClient: () => ErpQuery | undefined;
  store: EstoquePreVencidoStore;
}

/**
 * Baixas de Pré-vencido das vendas feitas no Closing Period, Loja a Loja (todas as Lojas com Itens, ou só as pedidas).
 * Único lugar que diz quais são as Baixas de um Período: a aba Baixas e o Indicador "Pré-vencidos vendidos" leem daqui.
 * Hoje recalcula pelo motor com as vendas do ERP; lança `SEM_CONEXAO` sem conexão e o erro do ERP se ele falhar.
 */
export async function baixasDoPeriodo({ erpClient, store }: BaixasDoPeriodoDeps, periodo: PeriodoDasBaixas, lojas?: readonly number[]): Promise<BaixaDoPeriodo[]> {
  const inicio = `${periodo.startDate} 00:00:00`;
  const fim = `${periodo.endDate} 23:59:59`;
  const resultado: BaixaDoPeriodo[] = [];
  for (const codigoLoja of lojas ?? (await store.lojas())) {
    const itens = await store.listar(codigoLoja);
    if (itens.length === 0) continue;
    const client = erpClient();
    if (!client) throw new Error(SEM_CONEXAO);
    const produtos = new Map(itens.map((i) => [i.produtoId, { nomeProduto: i.nomeProduto, codigoBarra: i.codigoBarra }]));
    const { baixas } = await baixasDaLoja(client, codigoLoja, itens);
    for (const { venda, quantidade } of baixas) {
      if (venda.data < inicio || venda.data > fim) continue;
      resultado.push({ codigoLoja, venda, quantidade, ...(produtos.get(venda.produtoId) ?? { nomeProduto: "", codigoBarra: null }) });
    }
  }
  return resultado;
}
