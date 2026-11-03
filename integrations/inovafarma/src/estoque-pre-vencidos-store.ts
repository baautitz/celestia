import { randomUUID } from "node:crypto";

/** Item de Pré-vencido do Estoque de uma Loja. `codigoProduto` é o código do ERP e nunca sai do servidor. */
export interface ItemPreVencido {
  id: string;
  codigoLoja: number;
  /** Identificador opaco do produto (`Produto.rowguid`). */
  produtoId: string;
  codigoProduto: number;
  nomeProduto: string;
  codigoBarra: string | null;
  /** Mês e ano da validade, `AAAA-MM`. */
  validade: string;
  quantidade: number;
  /** Data de inclusão (ISO): só as vendas a partir dela gastam o Item. */
  incluidoEm: string;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

/** O que a edição muda; `incluidoEm` (ISO) só quando a data de inclusão é ajustada. */
export interface EdicaoItemPreVencido {
  quantidade: number;
  validade: string;
  incluidoEm?: string;
}

export type NovoItemPreVencido = Omit<ItemPreVencido, "id" | "version" | "criadoEm" | "atualizadoEm">;

export interface EstoquePreVencidoStore {
  criar(novo: NovoItemPreVencido): Promise<ItemPreVencido>;
  /** Itens da Loja, o incluído antes primeiro. */
  listar(codigoLoja: number): Promise<ItemPreVencido[]>;
  /** Lojas que têm algum Item, em ordem. */
  lojas(): Promise<number[]>;
  get(id: string): Promise<ItemPreVencido | null>;
  /** Compare-and-set pela `version`; devolve null se o Item mudou ou sumiu. */
  atualizar(id: string, valores: EdicaoItemPreVencido, expectedVersion: number): Promise<ItemPreVencido | null>;
  /** Compare-and-set pela `version`; false se o Item mudou ou sumiu. */
  excluir(id: string, expectedVersion: number): Promise<boolean>;
}

export const novoIdItem = (): string => `ipv_${randomUUID()}`;

/** Ordem de inclusão: a data de inclusão e, entre iguais, a criação. */
export const porInclusao = (a: ItemPreVencido, b: ItemPreVencido) => a.incluidoEm.localeCompare(b.incluidoEm) || a.criadoEm.localeCompare(b.criadoEm) || a.id.localeCompare(b.id);

export class MemoryEstoquePreVencidoStore implements EstoquePreVencidoStore {
  private readonly itens = new Map<string, ItemPreVencido>();

  async criar(novo: NovoItemPreVencido): Promise<ItemPreVencido> {
    const agora = new Date().toISOString();
    const item = { ...novo, id: novoIdItem(), version: 1, criadoEm: agora, atualizadoEm: agora };
    this.itens.set(item.id, item);
    return item;
  }

  async listar(codigoLoja: number): Promise<ItemPreVencido[]> {
    return [...this.itens.values()].filter((i) => i.codigoLoja === codigoLoja).sort(porInclusao);
  }

  async lojas(): Promise<number[]> {
    return [...new Set([...this.itens.values()].map((i) => i.codigoLoja))].sort((a, b) => a - b);
  }

  async get(id: string): Promise<ItemPreVencido | null> {
    return this.itens.get(id) ?? null;
  }

  async atualizar(id: string, valores: EdicaoItemPreVencido, expectedVersion: number): Promise<ItemPreVencido | null> {
    const atual = this.itens.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    const atualizado = { ...atual, ...valores, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.itens.set(id, atualizado);
    return atualizado;
  }

  async excluir(id: string, expectedVersion: number): Promise<boolean> {
    const atual = this.itens.get(id);
    if (!atual || atual.version !== expectedVersion) return false;
    return this.itens.delete(id);
  }
}
