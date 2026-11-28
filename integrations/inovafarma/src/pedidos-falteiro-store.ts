import { randomUUID } from "node:crypto";
import type { DadosFalteiro, EdicaoFalteiro, Falta } from "./pedidos-falteiro.js";

/** Já existe falta ativa para este `(produtoId, codigoLoja)` (incluindo `codigoLoja = null`). */
export class FaltaDuplicadaError extends Error {}

export interface FalteiroStore {
  /** Do mais recente para o mais antigo. */
  listar(): Promise<Falta[]>;
  get(id: string): Promise<Falta | null>;
  /** Lança `FaltaDuplicadaError` se já houver falta ativa para `(produtoId, codigoLoja)`. */
  criar(dados: DadosFalteiro, autor: { id: string; nome: string }): Promise<Falta>;
  /** Compare-and-set pela `version`; `null` se mudou ou sumiu. Lança `FaltaDuplicadaError` se colidir com outro slot. */
  atualizar(id: string, dados: EdicaoFalteiro, expectedVersion: number): Promise<Falta | null>;
  /** Compare-and-set pela `version`; `false` se mudou ou sumiu. */
  remover(id: string, expectedVersion: number): Promise<boolean>;
}

export const novoIdFalteiro = (): string => `flt_${randomUUID()}`;

export class MemoryFalteiroStore implements FalteiroStore {
  private readonly faltas = new Map<string, Falta>();
  private seq = 0;

  async listar(): Promise<Falta[]> {
    return [...this.faltas.values()].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm) || b.id.localeCompare(a.id));
  }

  async get(id: string): Promise<Falta | null> {
    return this.faltas.get(id) ?? null;
  }

  async criar(dados: DadosFalteiro, autor: { id: string; nome: string }): Promise<Falta> {
    this.garantirSlotUnico(dados.produtoId, dados.codigoLoja);
    const agora = new Date(Date.now() + this.seq++).toISOString();
    const falta: Falta = {
      id: novoIdFalteiro(),
      produtoId: dados.produtoId,
      codigoLoja: dados.codigoLoja,
      quantidade: dados.quantidade,
      observacao: dados.observacao,
      criadoPorId: autor.id,
      criadoPorNome: autor.nome,
      version: 1,
      criadoEm: agora,
      atualizadoEm: agora,
    };
    this.faltas.set(falta.id, falta);
    return falta;
  }

  async atualizar(id: string, dados: EdicaoFalteiro, expectedVersion: number): Promise<Falta | null> {
    const atual = this.faltas.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    this.garantirSlotUnico(atual.produtoId, dados.codigoLoja, id);
    const nova: Falta = {
      ...atual,
      codigoLoja: dados.codigoLoja,
      quantidade: dados.quantidade,
      observacao: dados.observacao,
      version: atual.version + 1,
      atualizadoEm: new Date().toISOString(),
    };
    this.faltas.set(id, nova);
    return nova;
  }

  async remover(id: string, expectedVersion: number): Promise<boolean> {
    const atual = this.faltas.get(id);
    if (!atual || atual.version !== expectedVersion) return false;
    return this.faltas.delete(id);
  }

  private garantirSlotUnico(produtoId: string, codigoLoja: number | null, excetoId?: string): void {
    if ([...this.faltas.values()].some((f) => f.id !== excetoId && f.produtoId === produtoId && f.codigoLoja === codigoLoja)) {
      throw new FaltaDuplicadaError();
    }
  }
}
