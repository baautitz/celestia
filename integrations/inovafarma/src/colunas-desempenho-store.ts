import { randomUUID } from "node:crypto";
import { mesmoNome, NomeDuplicadoError } from "./erros-de-store.js";
import type { ColunaDesempenho, DadosColunaDesempenho } from "./colunas-desempenho.js";

export interface ColunaDesempenhoStore {
  /** Na ordem da tela (`ordem`, depois o nome). */
  listar(): Promise<ColunaDesempenho[]>;
  coluna(id: string): Promise<ColunaDesempenho | null>;
  /** Entra por último. Lança `NomeDuplicadoError` se já há uma coluna com o nome (sem diferenciar maiúsculas). */
  criar(dados: DadosColunaDesempenho): Promise<ColunaDesempenho>;
  /** Compare-and-set pela `version`; null se a coluna mudou ou sumiu. Lança `NomeDuplicadoError` como `criar`. */
  atualizar(id: string, dados: DadosColunaDesempenho, expectedVersion: number): Promise<ColunaDesempenho | null>;
  /** Compare-and-set pela `version`; false se a coluna mudou ou sumiu. */
  remover(id: string, expectedVersion: number): Promise<boolean>;
}

export const novoIdColuna = (): string => `cdv_${randomUUID()}`;

export const ordenarColunas = <C extends Pick<ColunaDesempenho, "ordem" | "nome">>(colunas: C[]): C[] =>
  [...colunas].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));

export class MemoryColunaDesempenhoStore implements ColunaDesempenhoStore {
  private readonly colunas = new Map<string, ColunaDesempenho>();

  async listar(): Promise<ColunaDesempenho[]> {
    return ordenarColunas([...this.colunas.values()]);
  }

  async coluna(id: string): Promise<ColunaDesempenho | null> {
    return this.colunas.get(id) ?? null;
  }

  async criar(dados: DadosColunaDesempenho): Promise<ColunaDesempenho> {
    this.garantirNomeUnico(dados.nome);
    const agora = new Date().toISOString();
    const ordem = Math.max(0, ...[...this.colunas.values()].map((c) => c.ordem)) + 1;
    const coluna = { ...dados, id: novoIdColuna(), ordem, version: 1, criadoEm: agora, atualizadoEm: agora };
    this.colunas.set(coluna.id, coluna);
    return coluna;
  }

  async atualizar(id: string, dados: DadosColunaDesempenho, expectedVersion: number): Promise<ColunaDesempenho | null> {
    const atual = this.colunas.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    this.garantirNomeUnico(dados.nome, id);
    const atualizada = { ...atual, ...dados, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.colunas.set(id, atualizada);
    return atualizada;
  }

  async remover(id: string, expectedVersion: number): Promise<boolean> {
    const atual = this.colunas.get(id);
    if (!atual || atual.version !== expectedVersion) return false;
    return this.colunas.delete(id);
  }

  private garantirNomeUnico(nome: string, id?: string): void {
    if ([...this.colunas.values()].some((c) => c.id !== id && mesmoNome(c.nome, nome))) throw new NomeDuplicadoError();
  }
}
