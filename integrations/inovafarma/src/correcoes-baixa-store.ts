import { randomUUID } from "node:crypto";

/** Correção de Baixa de uma linha de venda (venda + produto) de uma Loja. */
export interface CorrecaoBaixa {
  id: string;
  /** Período da venda: só se corrige no Closing Period aberto. */
  periodoId: string;
  codigoLoja: number;
  vendaId: number;
  produtoId: string;
  /** Quanto da venda foi de fato Pré-vencido. */
  quantidade: number;
  motivo: string;
  autorId: string;
  autorNome: string;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

export type NovaCorrecaoBaixa = Omit<CorrecaoBaixa, "id" | "version" | "criadoEm" | "atualizadoEm">;
export type EdicaoCorrecaoBaixa = Pick<CorrecaoBaixa, "quantidade" | "motivo" | "autorId" | "autorNome">;

/** A linha de venda já tem Correção: edite a que existe. */
export class CorrecaoDuplicadaError extends Error {}

export interface CorrecaoBaixaStore {
  /** Lança `CorrecaoDuplicadaError` se a linha de venda já tem Correção. */
  criar(nova: NovaCorrecaoBaixa): Promise<CorrecaoBaixa>;
  get(id: string): Promise<CorrecaoBaixa | null>;
  /** Correções das vendas de uma Loja. */
  daLoja(codigoLoja: number): Promise<CorrecaoBaixa[]>;
  /** Compare-and-set pela `version`; null se a Correção mudou ou sumiu. */
  atualizar(id: string, valores: EdicaoCorrecaoBaixa, expectedVersion: number): Promise<CorrecaoBaixa | null>;
  /** Compare-and-set pela `version`; false se a Correção mudou ou sumiu. */
  excluir(id: string, expectedVersion: number): Promise<boolean>;
}

export const novoIdCorrecao = (): string => `cbx_${randomUUID()}`;

export class MemoryCorrecaoBaixaStore implements CorrecaoBaixaStore {
  private readonly correcoes = new Map<string, CorrecaoBaixa>();

  async criar(nova: NovaCorrecaoBaixa): Promise<CorrecaoBaixa> {
    const mesma = [...this.correcoes.values()].some((c) => c.codigoLoja === nova.codigoLoja && c.vendaId === nova.vendaId && c.produtoId === nova.produtoId);
    if (mesma) throw new CorrecaoDuplicadaError();
    const agora = new Date().toISOString();
    const correcao = { ...nova, id: novoIdCorrecao(), version: 1, criadoEm: agora, atualizadoEm: agora };
    this.correcoes.set(correcao.id, correcao);
    return { ...correcao };
  }

  async get(id: string): Promise<CorrecaoBaixa | null> {
    const c = this.correcoes.get(id);
    return c ? { ...c } : null;
  }

  async daLoja(codigoLoja: number): Promise<CorrecaoBaixa[]> {
    return [...this.correcoes.values()].filter((c) => c.codigoLoja === codigoLoja).map((c) => ({ ...c }));
  }

  async atualizar(id: string, valores: EdicaoCorrecaoBaixa, expectedVersion: number): Promise<CorrecaoBaixa | null> {
    const atual = this.correcoes.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    const atualizada = { ...atual, ...valores, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.correcoes.set(id, atualizada);
    return { ...atualizada };
  }

  async excluir(id: string, expectedVersion: number): Promise<boolean> {
    const atual = this.correcoes.get(id);
    if (!atual || atual.version !== expectedVersion) return false;
    return this.correcoes.delete(id);
  }
}
