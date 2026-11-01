export type SituacaoConferencia = "verde" | "vermelho";

export interface LancamentoParaConferir {
  codigoColaborador: number;
  nomeColaborador: string;
  /** Identificador opaco do produto (nunca o código do ERP). */
  produtoId: string;
  nomeProduto: string;
  quantidade: number;
  /** Mês e ano da validade, `AAAA-MM`. */
  validade: string;
}

export interface VendaParaConferir {
  codigoColaborador: number;
  produtoId: string;
  quantidade: number;
}

export interface DetalheConferencia {
  produtoId: string;
  nomeProduto: string;
  validades: string[];
  quantidadeLancada: number;
  quantidadeVendida: number;
  situacao: SituacaoConferencia;
}

export interface LinhaConferencia {
  codigoColaborador: number;
  nomeColaborador: string;
  produtos: number;
  quantidadeLancada: number;
  quantidadeVendida: number;
  produtosConformes: number;
  /** Verde só se todos os produtos do Colaborador estão conformes. */
  situacao: SituacaoConferencia;
  detalhe: DetalheConferencia[];
}

/**
 * Compara o declarado com o vendido por Colaborador e produto: verde se vendido >= lançado.
 * Os lançamentos do mesmo produto somam, qualquer que seja a validade (a venda do ERP não distingue lote).
 */
export function conferir(lancamentos: LancamentoParaConferir[], vendas: VendaParaConferir[]): LinhaConferencia[] {
  const vendido = new Map<string, number>();
  for (const v of vendas) {
    const chave = `${v.codigoColaborador}|${v.produtoId}`;
    vendido.set(chave, (vendido.get(chave) ?? 0) + v.quantidade);
  }

  const porColaborador = new Map<number, { nome: string; produtos: Map<string, DetalheConferencia> }>();
  for (const l of lancamentos) {
    const colaborador = porColaborador.get(l.codigoColaborador) ?? { nome: l.nomeColaborador, produtos: new Map() };
    porColaborador.set(l.codigoColaborador, colaborador);
    const produto = colaborador.produtos.get(l.produtoId) ?? {
      produtoId: l.produtoId,
      nomeProduto: l.nomeProduto,
      validades: [],
      quantidadeLancada: 0,
      quantidadeVendida: vendido.get(`${l.codigoColaborador}|${l.produtoId}`) ?? 0,
      situacao: "vermelho" as SituacaoConferencia,
    };
    produto.quantidadeLancada += l.quantidade;
    if (!produto.validades.includes(l.validade)) produto.validades.push(l.validade);
    colaborador.produtos.set(l.produtoId, produto);
  }

  return [...porColaborador.entries()]
    .sort(([a], [b]) => a - b)
    .map(([codigoColaborador, { nome, produtos }]) => {
      const detalhe = [...produtos.values()].map((d) => ({
        ...d,
        validades: [...d.validades].sort(),
        situacao: (d.quantidadeVendida >= d.quantidadeLancada ? "verde" : "vermelho") as SituacaoConferencia,
      }));
      const produtosConformes = detalhe.filter((d) => d.situacao === "verde").length;
      return {
        codigoColaborador,
        nomeColaborador: nome,
        produtos: detalhe.length,
        quantidadeLancada: detalhe.reduce((acc, d) => acc + d.quantidadeLancada, 0),
        quantidadeVendida: detalhe.reduce((acc, d) => acc + d.quantidadeVendida, 0),
        produtosConformes,
        situacao: (produtosConformes === detalhe.length ? "verde" : "vermelho") as SituacaoConferencia,
        detalhe,
      };
    });
}
