import type { ResultadoParticipante } from "./apuracao.js";
import type { TipoMeta } from "./tipos-meta.js";

/** O Tipo de Meta como estava na Apuração: alterá-lo depois não muda um Período fechado (ADR 0007). */
export type TipoApuracao = Pick<TipoMeta, "id" | "nome" | "indicador" | "exibicao" | "mostrarPremio" | "semAlvo"> & { premio: string };

export interface MetaApurada {
  metaId: string;
  tipo: TipoApuracao;
  participantes: ResultadoParticipante[];
}

/** Apuração das Metas de um Closing Period: ao vivo com ele aberto, gravada no fechamento. */
export interface ApuracaoPeriodo {
  periodoId: string;
  metas: MetaApurada[];
  apuradoEm: string;
}

/** Apurações gravadas no fechamento dos Closing Periods. */
export interface ApuracaoStore {
  apuracao(periodoId: string): Promise<ApuracaoPeriodo | null>;
  /** Grava (ou substitui) a Apuração do Período. */
  gravar(apuracao: ApuracaoPeriodo): Promise<void>;
  /** Descarta a Apuração gravada: o Período reaberto volta a apurar ao vivo. */
  descartar(periodoId: string): Promise<void>;
}

export class MemoryApuracaoStore implements ApuracaoStore {
  private readonly apuracoes = new Map<string, ApuracaoPeriodo>();

  async apuracao(periodoId: string): Promise<ApuracaoPeriodo | null> {
    return this.apuracoes.get(periodoId) ?? null;
  }

  async gravar(apuracao: ApuracaoPeriodo): Promise<void> {
    this.apuracoes.set(apuracao.periodoId, structuredClone(apuracao));
  }

  async descartar(periodoId: string): Promise<void> {
    this.apuracoes.delete(periodoId);
  }
}
