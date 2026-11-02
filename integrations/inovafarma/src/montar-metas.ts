import type { Meta, NovaMeta, ParticipanteMeta } from "./metas-store.js";
import type { TipoMeta } from "./tipos-meta.js";

/** Colaborador ativo no ERP: quem entra por padrão nas Metas. */
export interface ColaboradorAtivo {
  codigoColaborador: number;
  nome: string;
}

/** Se o Participante precisa de um Alvo próprio: não no Tipo sem Alvo nem na Lista de Produtos (as quantidades ficam na Lista). */
export const usaAlvo = (tipo: Pick<TipoMeta, "semAlvo" | "indicador">): boolean => !tipo.semAlvo && tipo.indicador !== "lista-produtos";

/** Alvo com que um Colaborador entra na Meta: o Alvo padrão do Tipo ou pendente (null). */
export const alvoInicial = (tipo: Pick<TipoMeta, "semAlvo" | "indicador" | "alvoPadrao">): number | null => (usaAlvo(tipo) ? tipo.alvoPadrao : null);

/** Participantes com o Alvo em branco, a preencher pelo gestor. */
export const pendentes = (meta: Pick<Meta, "participantes">, tipo: Pick<TipoMeta, "semAlvo" | "indicador">): ParticipanteMeta[] =>
  usaAlvo(tipo) ? meta.participantes.filter((p) => p.alvo === null) : [];

/** Meta nova: todos os Colaboradores ativos são Participantes, com o Alvo padrão. */
export const novaMeta = (periodoId: string, tipo: TipoMeta, ativos: ColaboradorAtivo[]): NovaMeta => ({
  periodoId,
  tipoId: tipo.id,
  participantes: ativos.map((c) => ({ ...c, alvo: alvoInicial(tipo) })),
  excluidos: [],
  lista: tipo.indicador === "lista-produtos" ? { produtos: [], minimo: null, ajustes: [] } : null,
});

/**
 * Cópia automática de uma Meta para outro Período: os desativados saem, os desmarcados continuam fora
 * e os Colaboradores novos entram com o Alvo padrão (ou pendentes). Alvos e Lista de Produtos vêm junto.
 */
export function copiarMeta(origem: Meta, periodoId: string, tipo: TipoMeta, ativos: ColaboradorAtivo[]) {
  const ativo = new Map(ativos.map((c) => [c.codigoColaborador, c]));
  const ficam = origem.participantes.filter((p) => ativo.has(p.codigoColaborador)).map((p) => ({ ...p, nome: ativo.get(p.codigoColaborador)!.nome }));
  const sairam = origem.participantes.filter((p) => !ativo.has(p.codigoColaborador));
  const excluidos = origem.excluidos.filter((c) => ativo.has(c));
  const conhecidos = new Set([...ficam.map((p) => p.codigoColaborador), ...excluidos]);
  const novos = ativos.filter((c) => !conhecidos.has(c.codigoColaborador)).map((c) => ({ ...c, alvo: alvoInicial(tipo) }));
  const participantes = [...ficam, ...novos];
  const noMeta = new Set(participantes.map((p) => p.codigoColaborador));
  const lista = origem.lista && { ...origem.lista, ajustes: origem.lista.ajustes.filter((a) => noMeta.has(a.codigoColaborador)) };
  const nova: NovaMeta = { periodoId, tipoId: tipo.id, participantes, excluidos, lista };
  return { nova, novos, sairam };
}

/** O Período cujas Metas foram alteradas por último (a origem da cópia automática), fora o pedido. */
export function periodoAtualizadoPorUltimo(metas: Meta[], exceto: string): string | null {
  let ultima: Meta | null = null;
  for (const m of metas) if (m.periodoId !== exceto && (!ultima || m.atualizadoEm > ultima.atualizadoEm)) ultima = m;
  return ultima?.periodoId ?? null;
}
