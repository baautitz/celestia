import { randomUUID } from "node:crypto";

/** Colaborador que participa de uma Meta, com o próprio Alvo (null: pendente, em branco). */
export interface ParticipanteMeta {
  codigoColaborador: number;
  /** Nome no momento em que entrou na Meta: continua legível se o Colaborador sair do ERP. */
  nome: string;
  /** Na unidade do Indicador do Tipo de Meta (R$ em centavos). */
  alvo: number | null;
}

/** Um Tipo de Meta aplicado a um Closing Period: no máximo uma Meta por Tipo por Período. */
export interface Meta {
  id: string;
  periodoId: string;
  tipoId: string;
  participantes: ParticipanteMeta[];
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

export type NovaMeta = Pick<Meta, "periodoId" | "tipoId" | "participantes">;

export interface MetaStore {
  /** Metas dos Closing Periods pedidos, com os Participantes em ordem de nome. */
  listar(periodoIds: string[]): Promise<Meta[]>;
  meta(id: string): Promise<Meta | null>;
  /** null se o Período já tem Meta deste Tipo. */
  criar(nova: NovaMeta): Promise<Meta | null>;
  /** Define o mesmo Alvo para os Participantes pedidos. Compare-and-set pela `version`; null se a Meta mudou ou sumiu. */
  definirAlvo(id: string, codigos: number[], alvo: number | null, expectedVersion: number): Promise<Meta | null>;
}

export const novoIdMeta = (): string => `met_${randomUUID()}`;
export const ordenarParticipantes = (ps: ParticipanteMeta[]) => [...ps].sort((a, b) => a.nome.localeCompare(b.nome) || a.codigoColaborador - b.codigoColaborador);

export class MemoryMetaStore implements MetaStore {
  private readonly metas = new Map<string, Meta>();

  async listar(periodoIds: string[]): Promise<Meta[]> {
    return [...this.metas.values()].filter((m) => periodoIds.includes(m.periodoId));
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
    const atual = this.metas.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    const participantes = atual.participantes.map((p) => (codigos.includes(p.codigoColaborador) ? { ...p, alvo } : p));
    const atualizada = { ...atual, participantes, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.metas.set(id, atualizada);
    return atualizada;
  }
}
