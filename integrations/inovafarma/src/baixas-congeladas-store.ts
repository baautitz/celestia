import type { BaixaDeVenda } from "./baixas-pre-vencidos.js";
import type { VendaDaLoja } from "./baixas-da-loja.js";

/** Um Item no congelamento: a quantidade de então (para acompanhar uma edição posterior) e o Restante. */
export interface ItemCongelado {
  quantidade: number;
  restante: number;
}

/** Baixas de Pré-vencido de uma Loja num Closing Period fechado, gravadas no fechamento. */
export interface BaixasCongeladas {
  periodoId: string;
  codigoLoja: number;
  /** Fim do Período na hora do ERP: as vendas até aqui (inclusive) já estão contadas. */
  ate: string;
  /** Baixas das vendas do Período. */
  baixas: BaixaDeVenda<VendaDaLoja>[];
  /** Quantidade e Restante de cada Item no fim do Período, pelo id. */
  itens: Record<string, ItemCongelado>;
  congeladoEm: string;
}

export interface BaixasCongeladasStore {
  /** As Baixas congeladas de um Período, de todas as Lojas. */
  doPeriodo(periodoId: string): Promise<BaixasCongeladas[]>;
  /** Os congelamentos de uma Loja, o mais antigo primeiro. */
  daLoja(codigoLoja: number): Promise<BaixasCongeladas[]>;
  /** Grava o congelamento do Período, substituindo o que houver dele. */
  gravar(periodoId: string, congeladas: BaixasCongeladas[]): Promise<void>;
  /** Descarta o congelamento do Período: reaberto, ele volta a calcular ao vivo. */
  descartar(periodoId: string): Promise<void>;
}

export class MemoryBaixasCongeladasStore implements BaixasCongeladasStore {
  private readonly porPeriodo = new Map<string, BaixasCongeladas[]>();

  async doPeriodo(periodoId: string): Promise<BaixasCongeladas[]> {
    return structuredClone(this.porPeriodo.get(periodoId) ?? []);
  }

  async daLoja(codigoLoja: number): Promise<BaixasCongeladas[]> {
    return structuredClone([...this.porPeriodo.values()].flat().filter((c) => c.codigoLoja === codigoLoja)).sort((a, b) => a.ate.localeCompare(b.ate));
  }

  async gravar(periodoId: string, congeladas: BaixasCongeladas[]): Promise<void> {
    this.porPeriodo.set(periodoId, structuredClone(congeladas));
  }

  async descartar(periodoId: string): Promise<void> {
    this.porPeriodo.delete(periodoId);
  }
}
