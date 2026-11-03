import { randomUUID } from "node:crypto";
import type { RegraPremio } from "./tipos-meta.js";

/** Colaborador que participa de uma Meta, com o próprio Alvo (null: pendente, em branco). */
export interface ParticipanteMeta {
  codigoColaborador: number;
  /** Nome no momento em que entrou na Meta: continua legível se o Colaborador sair do ERP. */
  nome: string;
  /** Na unidade do Indicador do Tipo de Meta (R$ em centavos). */
  alvo: number | null;
  /** Prêmio próprio do Participante, no tipo de regra do Tipo de Meta; sem ele, vale o do Tipo de Meta. */
  premio?: RegraPremio | null;
}

/** Um Tipo de Meta aplicado a um Closing Period: no máximo uma Meta por Tipo por Período. */
export interface Meta {
  id: string;
  periodoId: string;
  tipoId: string;
  participantes: ParticipanteMeta[];
  /** Colaboradores ativos que o gestor desmarcou: não entram de novo na cópia automática. */
  excluidos: number[];
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

export type NovaMeta = Pick<Meta, "periodoId" | "tipoId" | "participantes" | "excluidos">;
export type DadosMeta = Pick<Meta, "participantes" | "excluidos">;

export interface AplicacaoAlvo {
  id: string;
  codigos: number[];
  expectedVersion: number;
}

export interface MetaStore {
  /** Metas dos Closing Periods pedidos, com os Participantes em ordem de nome. */
  listar(periodoIds: string[]): Promise<Meta[]>;
  meta(id: string): Promise<Meta | null>;
  /** null se o Período já tem Meta deste Tipo. */
  criar(nova: NovaMeta): Promise<Meta | null>;
  /** Define o mesmo Alvo para os Participantes pedidos. Compare-and-set pela `version`; null se a Meta mudou ou sumiu. */
  definirAlvo(id: string, codigos: number[], alvo: number | null, expectedVersion: number): Promise<Meta | null>;
  /** `definirAlvo` em várias Metas, todas ou nenhuma: null se alguma mudou ou sumiu, e aí nenhuma é gravada. */
  definirAlvos(aplicacoes: AplicacaoAlvo[], alvo: number | null): Promise<Meta[] | null>;
  /** Grava Participantes e excluídos de uma vez. Compare-and-set pela `version`; null se a Meta mudou ou sumiu. */
  atualizar(id: string, dados: DadosMeta, expectedVersion: number): Promise<Meta | null>;
  /** Remove a Meta com os Participantes. Compare-and-set pela `version`; false se a Meta mudou ou sumiu. */
  excluir(id: string, expectedVersion: number): Promise<boolean>;
}

export const novoIdMeta = (): string => `met_${randomUUID()}`;
export const ordenarParticipantes = (ps: ParticipanteMeta[]) => [...ps].sort((a, b) => a.nome.localeCompare(b.nome) || a.codigoColaborador - b.codigoColaborador);

export class MemoryMetaStore implements MetaStore {
  private readonly metas = new Map<string, Meta>();

  async listar(periodoIds: string[]): Promise<Meta[]> {
    return [...this.metas.values()].filter((m) => periodoIds.includes(m.periodoId));
  }

  async excluir(id: string, expectedVersion: number): Promise<boolean> {
    if (this.metas.get(id)?.version !== expectedVersion) return false;
    return this.metas.delete(id);
  }

  async meta(id: string): Promise<Meta | null> {
    return this.metas.get(id) ?? null;
  }

  async criar(nova: NovaMeta): Promise<Meta | null> {
    if ([...this.metas.values()].some((m) => m.periodoId === nova.periodoId && m.tipoId === nova.tipoId)) return null;
    const agora = new Date().toISOString();
    const meta = { ...nova, participantes: ordenarParticipantes(nova.participantes), id: novoIdMeta(), version: 1, criadoEm: agora, atualizadoEm: agora };
    this.metas.set(meta.id, meta);
    return meta;
  }

  async definirAlvo(id: string, codigos: number[], alvo: number | null, expectedVersion: number): Promise<Meta | null> {
    return (await this.definirAlvos([{ id, codigos, expectedVersion }], alvo))?.[0] ?? null;
  }

  async definirAlvos(aplicacoes: AplicacaoAlvo[], alvo: number | null): Promise<Meta[] | null> {
    if (!aplicacoes.every((a) => this.metas.get(a.id)?.version === a.expectedVersion)) return null;
    const agora = new Date().toISOString();
    return aplicacoes.map(({ id, codigos }) => {
      const atual = this.metas.get(id) as Meta;
      const participantes = atual.participantes.map((p) => (codigos.includes(p.codigoColaborador) ? { ...p, alvo } : p));
      const atualizada = { ...atual, participantes, version: atual.version + 1, atualizadoEm: agora };
      this.metas.set(id, atualizada);
      return atualizada;
    });
  }

  async atualizar(id: string, dados: DadosMeta, expectedVersion: number): Promise<Meta | null> {
    const atual = this.metas.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    const atualizada = { ...atual, ...dados, participantes: ordenarParticipantes(dados.participantes), version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.metas.set(id, atualizada);
    return atualizada;
  }
}
