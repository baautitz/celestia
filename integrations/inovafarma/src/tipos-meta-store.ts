import { randomUUID } from "node:crypto";
import type { DadosTipoMeta, TipoMeta } from "./tipos-meta.js";

export interface TipoMetaStore {
  listar(): Promise<TipoMeta[]>;
  tipo(id: string): Promise<TipoMeta | null>;
  criar(dados: DadosTipoMeta): Promise<TipoMeta>;
  /** Compare-and-set pela `version`; null se o Tipo de Meta mudou ou sumiu. */
  atualizar(id: string, dados: DadosTipoMeta, expectedVersion: number): Promise<TipoMeta | null>;
}

export const novoIdTipoMeta = (): string => `tme_${randomUUID()}`;

export class MemoryTipoMetaStore implements TipoMetaStore {
  private readonly tipos = new Map<string, TipoMeta>();

  async listar(): Promise<TipoMeta[]> {
    return [...this.tipos.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }

  async tipo(id: string): Promise<TipoMeta | null> {
    return this.tipos.get(id) ?? null;
  }

  async criar(dados: DadosTipoMeta): Promise<TipoMeta> {
    const agora = new Date().toISOString();
    const tipo = { ...dados, id: novoIdTipoMeta(), version: 1, criadoEm: agora, atualizadoEm: agora };
    this.tipos.set(tipo.id, tipo);
    return tipo;
  }

  async atualizar(id: string, dados: DadosTipoMeta, expectedVersion: number): Promise<TipoMeta | null> {
    const atual = this.tipos.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    const atualizado = { ...atual, ...dados, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.tipos.set(id, atualizado);
    return atualizado;
  }
}
