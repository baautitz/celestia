import { COLABORADORES_SQL } from "./colaboradores-routes.js";
import { META_TARGET, METAS_ACTIONS, METAS_PLUGIN } from "./metas-audit.js";
import type { Meta, MetaStore } from "./metas-store.js";
import { copiarMeta, pendentes, periodoAtualizadoPorUltimo, type ColaboradorAtivo } from "./montar-metas.js";
import type { PeriodoResumo } from "./pre-vencidos-routes.js";
import type { ErpQueryClient } from "./server.js";
import type { TipoMeta } from "./tipos-meta.js";
import type { TipoMetaStore } from "./tipos-meta-store.js";
import type { AuditService } from "./vinculo-audit.js";

export interface MetasDoPeriodoDeps {
  erpClient: () => ErpQueryClient | undefined;
  tipos: TipoMetaStore;
  metas: MetaStore;
  audit: AuditService;
}

type Ator = { id: string; name: string };

/** Num Período aberto valem só as Metas de Tipos ativos; um Período fechado mostra o que tinha. */
export const metasVisiveis = <M extends Pick<Meta, "tipoId">>(doPeriodo: M[], tipos: TipoMeta[], periodo: Pick<PeriodoResumo, "status">) =>
  doPeriodo.flatMap((meta) => {
    const tipo = tipos.find((t) => t.id === meta.tipoId);
    return tipo && (periodo.status !== "open" || tipo.ativo) ? [{ meta, tipo }] : [];
  });

/** Cópia automática: no primeiro acesso, um Período aberto sem Metas recebe as do Período atualizado por último. */
export function metasDoPeriodo({ erpClient, tipos, metas, audit }: MetasDoPeriodoDeps) {
  const registrar = (actor: Ator, action: string, meta: Meta, attributes: Record<string, unknown>) =>
    audit.record({ plugin: METAS_PLUGIN, action, actor, target: { type: META_TARGET, id: meta.id }, attributes });

  /** Colaboradores ativos no ERP, em ordem de nome; `null` quando o ERP não está configurado ou não responde. */
  const ativosDoErp = async (): Promise<ColaboradorAtivo[] | null> => {
    const client = erpClient();
    if (!client) return null;
    try {
      const rows = await client.query<{ codigoColaborador: number; nome: string | null; ativo: boolean | number }>(COLABORADORES_SQL);
      return rows
        .filter((r) => r.ativo)
        .map((r) => ({ codigoColaborador: Number(r.codigoColaborador), nome: (r.nome || "").trim() || `Colaborador cód. ${r.codigoColaborador}` }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
    } catch {
      return null;
    }
  };

  const copiar = async (actor: Ator, periodo: PeriodoResumo, todos: PeriodoResumo[], ativos: ColaboradorAtivo[]): Promise<PeriodoResumo | null> => {
    const origemId = periodoAtualizadoPorUltimo(await metas.listar(todos.map((p) => p.id)), periodo.id);
    const origem = todos.find((p) => p.id === origemId);
    if (!origem) return null;
    for (const meta of await metas.listar([origem.id])) {
      const tipo = await tipos.tipo(meta.tipoId);
      if (!tipo?.ativo) continue;
      const { nova, novos, sairam } = copiarMeta(meta, periodo.id, tipo, ativos);
      const criada = await metas.criar(nova);
      // Outro acesso simultâneo já copiou esta Meta.
      if (!criada) continue;
      await registrar(actor, METAS_ACTIONS.copiar, criada, {
        tipo: tipo.nome,
        periodo: periodo.name,
        origem: origem.name,
        participantes: criada.participantes.length,
        novos: novos.map((p) => p.nome),
        sairam: sairam.map((p) => p.nome),
        pendentes: pendentes(criada, tipo).length,
      });
    }
    return origem;
  };

  /**
   * Prepara as Metas de um Período aberto (cópia automática). Um Período fechado não muda.
   * Devolve `null` se o ERP não responde (sem os Colaboradores ativos não dá para criar Participantes).
   */
  const preparar = async (actor: Ator, periodo: PeriodoResumo, todos: PeriodoResumo[]) => {
    const ativos = await ativosDoErp();
    if (!ativos) return null;
    if (periodo.status !== "open") return { ativos, copiadoDe: null };
    let copiadoDe: string | null = null;
    if ((await metas.listar([periodo.id])).length === 0) copiadoDe = (await copiar(actor, periodo, todos, ativos))?.name ?? null;
    return { ativos, copiadoDe };
  };

  return { ativosDoErp, preparar, registrar };
}
