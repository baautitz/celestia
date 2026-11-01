import { randomUUID } from "node:crypto";

/** Avaliação do Colaborador: descrição e valor descontado (em centavos) num Closing Period e numa Loja. */
export interface Avaliacao {
  id: string;
  periodoId: string;
  codigoColaborador: number;
  nomeColaborador: string;
  codigoLoja: number;
  descricao: string;
  valorCentavos: number;
  criadoPor: string;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

export type NovaAvaliacao = Omit<Avaliacao, "id" | "version" | "criadoEm" | "atualizadoEm">;
export type EdicaoAvaliacao = Pick<Avaliacao, "descricao" | "valorCentavos">;

export interface FiltroAvaliacoes {
  periodoId: string;
  codigoColaborador?: number;
  /** Só as Avaliações destas Lojas; ausente, todas. */
  lojas?: number[];
}

export interface AvaliacaoStore {
  criar(nova: NovaAvaliacao): Promise<Avaliacao>;
  listar(filtro: FiltroAvaliacoes): Promise<Avaliacao[]>;
  get(id: string): Promise<Avaliacao | null>;
  /** Compare-and-set pela `version`; devolve null se a Avaliação mudou ou sumiu. */
  atualizar(id: string, valores: EdicaoAvaliacao, expectedVersion: number): Promise<Avaliacao | null>;
  /** Compare-and-set pela `version`; false se a Avaliação mudou ou sumiu. */
  excluir(id: string, expectedVersion: number): Promise<boolean>;
}

export const novoIdAvaliacao = (): string => `av_${randomUUID()}`;

export class MemoryAvaliacaoStore implements AvaliacaoStore {
  private readonly avaliacoes = new Map<string, Avaliacao>();

  async criar(nova: NovaAvaliacao): Promise<Avaliacao> {
    const agora = new Date().toISOString();
    const avaliacao = { ...nova, id: novoIdAvaliacao(), version: 1, criadoEm: agora, atualizadoEm: agora };
    this.avaliacoes.set(avaliacao.id, avaliacao);
    return avaliacao;
  }

  async listar({ periodoId, codigoColaborador, lojas }: FiltroAvaliacoes): Promise<Avaliacao[]> {
    return [...this.avaliacoes.values()]
      .filter((a) => a.periodoId === periodoId && (codigoColaborador === undefined || a.codigoColaborador === codigoColaborador) && (lojas === undefined || lojas.includes(a.codigoLoja)))
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  }

  async get(id: string): Promise<Avaliacao | null> {
    return this.avaliacoes.get(id) ?? null;
  }

  async atualizar(id: string, valores: EdicaoAvaliacao, expectedVersion: number): Promise<Avaliacao | null> {
    const atual = this.avaliacoes.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    const atualizada = { ...atual, ...valores, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.avaliacoes.set(id, atualizada);
    return atualizada;
  }

  async excluir(id: string, expectedVersion: number): Promise<boolean> {
    const atual = this.avaliacoes.get(id);
    if (!atual || atual.version !== expectedVersion) return false;
    return this.avaliacoes.delete(id);
  }
}
