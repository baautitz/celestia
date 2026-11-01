import { randomUUID } from "node:crypto";

/** Lançamento de Pré-vencido. `codigoProduto` é o código do ERP e nunca sai do servidor. */
export interface LancamentoPreVencido {
  id: string;
  periodoId: string;
  codigoColaborador: number;
  nomeColaborador: string;
  usuarioId: string;
  codigoLoja: number;
  /** Identificador opaco do produto (`Produto.rowguid`). */
  produtoId: string;
  codigoProduto: number;
  nomeProduto: string;
  codigoBarra: string | null;
  quantidade: number;
  /** Mês e ano da validade, `AAAA-MM`. */
  validade: string;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

export type NovoLancamento = Omit<LancamentoPreVencido, "id" | "version" | "criadoEm" | "atualizadoEm">;

export interface FiltroLancamentos {
  periodoId: string;
  codigoColaborador?: number;
  codigoLoja?: number;
}

export interface PreVencidoStore {
  criar(novo: NovoLancamento): Promise<LancamentoPreVencido>;
  listar(filtro: FiltroLancamentos): Promise<LancamentoPreVencido[]>;
  get(id: string): Promise<LancamentoPreVencido | null>;
  /** Compare-and-set pela `version`; devolve null se o lançamento mudou ou sumiu. */
  atualizar(id: string, valores: { quantidade: number; validade: string }, expectedVersion: number): Promise<LancamentoPreVencido | null>;
  /** Compare-and-set pela `version`; false se o lançamento mudou ou sumiu. */
  excluir(id: string, expectedVersion: number): Promise<boolean>;
}

export const novoId = (): string => `pv_${randomUUID()}`;

export class MemoryPreVencidoStore implements PreVencidoStore {
  private readonly lancamentos = new Map<string, LancamentoPreVencido>();

  async criar(novo: NovoLancamento): Promise<LancamentoPreVencido> {
    const agora = new Date().toISOString();
    const lancamento = { ...novo, id: novoId(), version: 1, criadoEm: agora, atualizadoEm: agora };
    this.lancamentos.set(lancamento.id, lancamento);
    return lancamento;
  }

  async listar({ periodoId, codigoColaborador, codigoLoja }: FiltroLancamentos): Promise<LancamentoPreVencido[]> {
    return [...this.lancamentos.values()]
      .filter((l) => l.periodoId === periodoId && (codigoColaborador === undefined || l.codigoColaborador === codigoColaborador) && (codigoLoja === undefined || l.codigoLoja === codigoLoja))
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  }

  async get(id: string): Promise<LancamentoPreVencido | null> {
    return this.lancamentos.get(id) ?? null;
  }

  async atualizar(id: string, valores: { quantidade: number; validade: string }, expectedVersion: number): Promise<LancamentoPreVencido | null> {
    const atual = this.lancamentos.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    const atualizado = { ...atual, ...valores, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.lancamentos.set(id, atualizado);
    return atualizado;
  }

  async excluir(id: string, expectedVersion: number): Promise<boolean> {
    const atual = this.lancamentos.get(id);
    if (!atual || atual.version !== expectedVersion) return false;
    return this.lancamentos.delete(id);
  }
}
