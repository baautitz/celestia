import { randomUUID } from "node:crypto";
import type { DadosPedido, Pedido } from "./pedidos.js";

export interface PedidoStore {
  /** Do mais recente para o mais antigo. */
  listar(): Promise<Pedido[]>;
  pedido(id: string): Promise<Pedido | null>;
  criar(dados: DadosPedido, autor: { id: string; nome: string }): Promise<Pedido>;
  /** Compare-and-set pela `version`, só em rascunho; null se o Pedido mudou, sumiu ou saiu do rascunho. */
  atualizarRascunho(id: string, dados: DadosPedido, expectedVersion: number): Promise<Pedido | null>;
  /** Compare-and-set pela `version`, em rascunho ou em cotação (antes de confirmar); null como em `atualizarRascunho`. */
  cancelar(id: string, expectedVersion: number): Promise<Pedido | null>;
  /** Compare-and-set pela `version`: rascunho -> aguardando preços; null se o Pedido mudou, sumiu ou saiu do rascunho. */
  iniciarCotacao(id: string, expectedVersion: number): Promise<Pedido | null>;
  /** aguardando preços -> cotado; null se o Pedido não está aguardando preços. */
  marcarCotado(id: string): Promise<Pedido | null>;
  /** Compare-and-set pela `version`: cotado -> confirmado com o fornecedor escolhido por produto; null se mudou ou não está cotado. */
  confirmar(id: string, escolhas: Record<string, number>, expectedVersion: number): Promise<Pedido | null>;
  /** Grava o resultado da conferência com a NF em um Pedido confirmado ou já em recebimento; null se o Pedido não está nessa fase. */
  registrarRecebimento(id: string, status: "confirmado" | "parcialmente_recebido" | "recebido"): Promise<Pedido | null>;
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
    const pedido: Pedido = { ...dados, id: novoIdPedido(), status: "rascunho", escolhas: {}, confirmadoEm: null, criadoPorId: autor.id, criadoPorNome: autor.nome, version: 1, criadoEm: agora, atualizadoEm: agora };
    this.pedidos.set(pedido.id, pedido);
    return pedido;
  }

  async atualizarRascunho(id: string, dados: DadosPedido, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, dados, ["rascunho", "aguardando_precos", "cotado"]);
  }

  async cancelar(id: string, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, { status: "cancelado" }, ["rascunho", "aguardando_precos", "cotado"]);
  }

  async iniciarCotacao(id: string, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, { status: "aguardando_precos" });
  }

  async marcarCotado(id: string): Promise<Pedido | null> {
    return this.mudar(id, undefined, { status: "cotado" }, "aguardando_precos");
  }

  async confirmar(id: string, escolhas: Record<string, number>, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, { status: "confirmado", escolhas, confirmadoEm: new Date().toISOString() }, "cotado");
  }

  async registrarRecebimento(id: string, status: "confirmado" | "parcialmente_recebido" | "recebido"): Promise<Pedido | null> {
    return this.mudar(id, undefined, { status }, ["confirmado", "parcialmente_recebido", "recebido"]);
  }

  private mudar(id: string, expectedVersion: number | undefined, mudancas: Partial<Pedido>, de: Pedido["status"] | Pedido["status"][] = "rascunho"): Pedido | null {
    const atual = this.pedidos.get(id);
    if (!atual || !([] as string[]).concat(de).includes(atual.status) || (expectedVersion !== undefined && atual.version !== expectedVersion)) return null;
    const novo = { ...atual, ...mudancas, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.pedidos.set(id, novo);
    return novo;
  }
}
