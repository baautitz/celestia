import { randomUUID } from "node:crypto";
import { mesmoNome, NomeDuplicadoError } from "./erros-de-store.js";
import type { DadosListaPedidos, ListaPedidos } from "./pedidos-listas.js";

export interface PedidosListasStore {
  /** Por nome. */
  listar(): Promise<ListaPedidos[]>;
  lista(id: string): Promise<ListaPedidos | null>;
  /** Lança `NomeDuplicadoError` se já há uma lista com o nome (sem diferenciar maiúsculas). */
  criar(dados: DadosListaPedidos): Promise<ListaPedidos>;
  /** Compare-and-set pela `version`; null se a lista mudou ou sumiu. Lança `NomeDuplicadoError` como `criar`. */
  atualizar(id: string, dados: DadosListaPedidos, expectedVersion: number): Promise<ListaPedidos | null>;
  /** Compare-and-set pela `version`; false se a lista mudou ou sumiu. */
  remover(id: string, expectedVersion: number): Promise<boolean>;
}

export const novoIdListaPedidos = (): string => `plp_${randomUUID()}`;

export const ordenarListas = <L extends Pick<ListaPedidos, "nome">>(listas: L[]): L[] => [...listas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

export class MemoryPedidosListasStore implements PedidosListasStore {
  private readonly listas = new Map<string, ListaPedidos>();

  async listar(): Promise<ListaPedidos[]> {
    return ordenarListas([...this.listas.values()]);
  }

  async lista(id: string): Promise<ListaPedidos | null> {
    return this.listas.get(id) ?? null;
  }

  async criar(dados: DadosListaPedidos): Promise<ListaPedidos> {
    this.garantirNomeUnico(dados.nome);
    const agora = new Date().toISOString();
    const lista = { ...dados, id: novoIdListaPedidos(), version: 1, criadoEm: agora, atualizadoEm: agora };
    this.listas.set(lista.id, lista);
    return lista;
  }

  async atualizar(id: string, dados: DadosListaPedidos, expectedVersion: number): Promise<ListaPedidos | null> {
    const atual = this.listas.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    this.garantirNomeUnico(dados.nome, id);
    const atualizada = { ...atual, ...dados, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.listas.set(id, atualizada);
    return atualizada;
  }

  async remover(id: string, expectedVersion: number): Promise<boolean> {
    const atual = this.listas.get(id);
    if (!atual || atual.version !== expectedVersion) return false;
    return this.listas.delete(id);
  }

  private garantirNomeUnico(nome: string, id?: string): void {
    if ([...this.listas.values()].some((l) => l.id !== id && mesmoNome(l.nome, nome))) throw new NomeDuplicadoError();
  }
}
