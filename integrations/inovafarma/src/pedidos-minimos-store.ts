/** Estoque Mínimo e máximo do Celestia por produto e Loja. Nunca vem do ERP. */
export interface MinimoMaximo {
  /** Identificador opaco do produto (`Produto.rowguid`). */
  produtoId: string;
  /** Código da Loja no ERP, sem FK. */
  codigoLoja: number;
  minimo: number;
  maximo: number | null;
  version: number;
}

export type ValoresMinimoMaximo = Pick<MinimoMaximo, "minimo" | "maximo">;

export interface MinimoMaximoStore {
  listar(): Promise<MinimoMaximo[]>;
  /** Compare-and-set pela `version` (0 = ainda sem registro); null se mudou. */
  definir(produtoId: string, codigoLoja: number, valores: ValoresMinimoMaximo, expectedVersion: number): Promise<MinimoMaximo | null>;
}

export class MemoryMinimoMaximoStore implements MinimoMaximoStore {
  private readonly linhas = new Map<string, MinimoMaximo>();

  async listar(): Promise<MinimoMaximo[]> {
    return [...this.linhas.values()];
  }

  async definir(produtoId: string, codigoLoja: number, valores: ValoresMinimoMaximo, expectedVersion: number): Promise<MinimoMaximo | null> {
    const chave = `${produtoId}|${codigoLoja}`;
    const atual = this.linhas.get(chave);
    if ((atual?.version ?? 0) !== expectedVersion) return null;
    const nova = { produtoId, codigoLoja, ...valores, version: expectedVersion + 1 };
    this.linhas.set(chave, nova);
    return nova;
  }
}
