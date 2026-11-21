import { randomUUID } from "node:crypto";
import type { DadosPedido, Pedido } from "./pedidos.js";

export interface PedidoStore {
  /** Do mais recente para o mais antigo. */
  listar(): Promise<Pedido[]>;
  pedido(id: string): Promise<Pedido | null>;
  criar(dados: DadosPedido, autor: { id: string; nome: string }): Promise<Pedido>;
  /** Compare-and-set pela `version`, só em rascunho; null se o Pedido mudou, sumiu ou saiu do rascunho. */
  atualizarRascunho(id: string, dados: DadosPedido, expectedVersion: number): Promise<Pedido | null>;
  /** Compare-and-set pela `version`, só em rascunho; null como em `atualizarRascunho`. */
  cancelarRascunho(id: string, expectedVersion: number): Promise<Pedido | null>;
  /** Compare-and-set pela `version`: rascunho -> aguardando preços; null se o Pedido mudou, sumiu ou saiu do rascunho. */
  iniciarCotacao(id: string, expectedVersion: number): Promise<Pedido | null>;
  /** aguardando preços -> cotado; null se o Pedido não está aguardando preços. */
  marcarCotado(id: string): Promise<Pedido | null>;
}

export const novoIdPedido = (): string => `ped_${randomUUID()}`;

export class MemoryPedidoStore implements PedidoStore {
  private readonly pedidos = new Map<string, Pedido>();

  async listar(): Promise<Pedido[]> {
    return [...this.pedidos.values()].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  }

  async pedido(id: string): Promise<Pedido | null> {
    return this.pedidos.get(id) ?? null;
  }

  async criar(dados: DadosPedido, autor: { id: string; nome: string }): Promise<Pedido> {
    const agora = new Date().toISOString();
    const pedido: Pedido = { ...dados, id: novoIdPedido(), status: "rascunho", criadoPorId: autor.id, criadoPorNome: autor.nome, version: 1, criadoEm: agora, atualizadoEm: agora };
    this.pedidos.set(pedido.id, pedido);
    return pedido;
  }

  async atualizarRascunho(id: string, dados: DadosPedido, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, dados);
  }

  async cancelarRascunho(id: string, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, { status: "cancelado" });
  }

  async iniciarCotacao(id: string, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, { status: "aguardando_precos" });
  }

  async marcarCotado(id: string): Promise<Pedido | null> {
    return this.mudar(id, undefined, { status: "cotado" }, "aguardando_precos");
  }

  private mudar(id: string, expectedVersion: number | undefined, mudancas: Partial<Pedido>, de: Pedido["status"] = "rascunho"): Pedido | null {
    const atual = this.pedidos.get(id);
    if (atual?.status !== de || (expectedVersion !== undefined && atual.version !== expectedVersion)) return null;
    const novo = { ...atual, ...mudancas, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.pedidos.set(id, novo);
    return novo;
  }
}
