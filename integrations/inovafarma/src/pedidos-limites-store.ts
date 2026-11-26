import { randomUUID } from "node:crypto";
import { mesmoNome, NomeDuplicadoError } from "./erros-de-store.js";
import type { DadosRegraLimite, DadosValorLimite, RegraLimite, ValorLimite } from "./pedidos-limites.js";

/** A Regra de Limite ainda tem Valores: eles são excluídos antes. */
export class RegraComValoresError extends Error {}
/** O Valor aponta para uma Regra de Limite que não existe mais. */
export class RegraInexistenteError extends Error {}

export interface LimitesStore {
  /** As Regras, por nome. */
  regras(): Promise<RegraLimite[]>;
  /** Lança `NomeDuplicadoError` se já há uma Regra com o nome (sem diferenciar maiúsculas). */
  criarRegra(dados: DadosRegraLimite): Promise<RegraLimite>;
  /** Compare-and-set pela `version`; null se mudou ou sumiu. Lança `NomeDuplicadoError` como `criarRegra`. */
  atualizarRegra(id: string, dados: DadosRegraLimite, expectedVersion: number): Promise<RegraLimite | null>;
  /** false se mudou ou sumiu. Lança `RegraComValoresError`. */
  removerRegra(id: string, expectedVersion: number): Promise<boolean>;
  /** Os Valores, da vigência mais recente para a mais antiga. */
  valores(): Promise<ValorLimite[]>;
  /** Lança `RegraInexistenteError`. */
  criarValor(dados: DadosValorLimite): Promise<ValorLimite>;
  /** Compare-and-set pela `version`; null se mudou ou sumiu. Lança `RegraInexistenteError`. */
  atualizarValor(id: string, dados: DadosValorLimite, expectedVersion: number): Promise<ValorLimite | null>;
  removerValor(id: string, expectedVersion: number): Promise<boolean>;
}

export const novoIdRegraLimite = (): string => `lre_${randomUUID()}`;
export const novoIdValorLimite = (): string => `lva_${randomUUID()}`;

export class MemoryLimitesStore implements LimitesStore {
  private readonly porRegra = new Map<string, RegraLimite>();
  private readonly porValor = new Map<string, ValorLimite>();

  async regras(): Promise<RegraLimite[]> {
    return [...this.porRegra.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  async criarRegra(dados: DadosRegraLimite): Promise<RegraLimite> {
    this.garantirNomeUnico(dados.nome);
    const regra = { ...dados, id: novoIdRegraLimite(), version: 1 };
    this.porRegra.set(regra.id, regra);
    return regra;
  }

  async atualizarRegra(id: string, dados: DadosRegraLimite, expectedVersion: number): Promise<RegraLimite | null> {
    const atual = this.porRegra.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    this.garantirNomeUnico(dados.nome, id);
    const nova = { ...dados, id, version: atual.version + 1 };
    this.porRegra.set(id, nova);
    return nova;
  }

  async removerRegra(id: string, expectedVersion: number): Promise<boolean> {
    if (this.porRegra.get(id)?.version !== expectedVersion) return false;
    if ([...this.porValor.values()].some((v) => v.regraId === id)) throw new RegraComValoresError();
    return this.porRegra.delete(id);
  }

  async valores(): Promise<ValorLimite[]> {
    return [...this.porValor.values()].sort((a, b) => b.inicio.localeCompare(a.inicio) || a.id.localeCompare(b.id));
  }

  async criarValor(dados: DadosValorLimite): Promise<ValorLimite> {
    this.garantirRegra(dados.regraId);
    const valor = { ...dados, id: novoIdValorLimite(), version: 1 };
    this.porValor.set(valor.id, valor);
    return valor;
  }

  async atualizarValor(id: string, dados: DadosValorLimite, expectedVersion: number): Promise<ValorLimite | null> {
    const atual = this.porValor.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    this.garantirRegra(dados.regraId);
    const novo = { ...dados, id, version: atual.version + 1 };
    this.porValor.set(id, novo);
    return novo;
  }

  async removerValor(id: string, expectedVersion: number): Promise<boolean> {
    if (this.porValor.get(id)?.version !== expectedVersion) return false;
    return this.porValor.delete(id);
  }

  private garantirRegra(id: string): void {
    if (!this.porRegra.has(id)) throw new RegraInexistenteError();
  }

  private garantirNomeUnico(nome: string, id?: string): void {
    if ([...this.porRegra.values()].some((r) => r.id !== id && mesmoNome(r.nome, nome))) throw new NomeDuplicadoError();
  }
}
