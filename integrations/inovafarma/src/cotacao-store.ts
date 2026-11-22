export interface Cotacao {
  pedidoId: string;
  codigoFornecedor: number;
  /** `produtoId` -> preço (null = sem oferta); null enquanto a planilha do fornecedor não foi importada. */
  precos: Record<string, number | null> | null;
  importadoEm: string | null;
  version: number;
}

export interface CotacaoStore {
  /** Os fornecedores do Pedido, na ordem em que foram escolhidos. */
  listar(pedidoId: string): Promise<Cotacao[]>;
  /** Um fornecedor participante por código, ainda sem preços. */
  criar(pedidoId: string, codigosFornecedor: number[]): Promise<Cotacao[]>;
  /** Compare-and-set pela `version` do fornecedor; null se mudou ou não participa. */
  gravarPrecos(pedidoId: string, codigoFornecedor: number, precos: Record<string, number | null>, expectedVersion: number): Promise<Cotacao | null>;
}

export class MemoryCotacaoStore implements CotacaoStore {
  private readonly cotacoes = new Map<string, Cotacao[]>();

  async listar(pedidoId: string): Promise<Cotacao[]> {
    return this.cotacoes.get(pedidoId) ?? [];
  }

  async criar(pedidoId: string, codigosFornecedor: number[]): Promise<Cotacao[]> {
    const criadas = codigosFornecedor.map((codigoFornecedor): Cotacao => ({ pedidoId, codigoFornecedor, precos: null, importadoEm: null, version: 1 }));
    this.cotacoes.set(pedidoId, criadas);
    return criadas;
  }

  async gravarPrecos(pedidoId: string, codigoFornecedor: number, precos: Record<string, number | null>, expectedVersion: number): Promise<Cotacao | null> {
    const lista = this.cotacoes.get(pedidoId) ?? [];
    const i = lista.findIndex((c) => c.codigoFornecedor === codigoFornecedor);
    const atual = lista[i];
    if (!atual || atual.version !== expectedVersion) return null;
    const nova = { ...atual, precos, importadoEm: new Date().toISOString(), version: atual.version + 1 };
    lista[i] = nova;
    return nova;
  }
}
