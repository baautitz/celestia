import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { metas, metasParticipantes } from "./schema.js";
import { novoIdMeta, ordenarParticipantes, type DadosMeta, type Meta, type MetaStore, type NovaMeta } from "./metas-store.js";

type MetaRow = typeof metas.$inferSelect;
type ParticipanteRow = typeof metasParticipantes.$inferSelect;

const meta = (row: MetaRow, participantes: ParticipanteRow[]): Meta => ({
  ...row,
  participantes: ordenarParticipantes(participantes.filter((p) => p.metaId === row.id).map(({ codigoColaborador, nome, alvo }) => ({ codigoColaborador, nome, alvo }))),
  criadoEm: row.criadoEm.toISOString(),
  atualizadoEm: row.atualizadoEm.toISOString(),
});

export class PostgresMetaStore implements MetaStore {
  constructor(private readonly db: NodePgDatabase) {}

  private async comParticipantes(rows: MetaRow[]): Promise<Meta[]> {
    if (rows.length === 0) return [];
    const participantes = await this.db.select().from(metasParticipantes).where(inArray(metasParticipantes.metaId, rows.map((r) => r.id)));
    return rows.map((r) => meta(r, participantes));
  }

  async listar(periodoIds: string[]): Promise<Meta[]> {
    if (periodoIds.length === 0) return [];
    return this.comParticipantes(await this.db.select().from(metas).where(inArray(metas.periodoId, periodoIds)));
  }

  async meta(id: string): Promise<Meta | null> {
    const [m] = await this.comParticipantes(await this.db.select().from(metas).where(eq(metas.id, id)));
    return m ?? null;
  }

  async criar(nova: NovaMeta): Promise<Meta | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(metas).values({ id: novoIdMeta(), periodoId: nova.periodoId, tipoId: nova.tipoId, excluidos: nova.excluidos, lista: nova.lista }).onConflictDoNothing().returning();
      if (!row) return null;
      if (nova.participantes.length) await tx.insert(metasParticipantes).values(nova.participantes.map((p) => ({ ...p, metaId: row.id })));
      return meta(row, nova.participantes.map((p) => ({ ...p, metaId: row.id })));
    });
  }

  async definirAlvo(id: string, codigos: number[], alvo: number | null, expectedVersion: number): Promise<Meta | null> {
    const atualizada = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(metas)
        .set({ version: expectedVersion + 1, atualizadoEm: new Date() })
        .where(and(eq(metas.id, id), eq(metas.version, expectedVersion)))
        .returning();
      if (!row) return null;
      if (codigos.length) await tx.update(metasParticipantes).set({ alvo }).where(and(eq(metasParticipantes.metaId, id), inArray(metasParticipantes.codigoColaborador, codigos)));
      return row;
    });
    return atualizada ? this.meta(id) : null;
  }

  async atualizar(id: string, dados: DadosMeta, expectedVersion: number): Promise<Meta | null> {
    const atualizada = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(metas)
        .set({ excluidos: dados.excluidos, lista: dados.lista, version: expectedVersion + 1, atualizadoEm: new Date() })
        .where(and(eq(metas.id, id), eq(metas.version, expectedVersion)))
        .returning();
      if (!row) return null;
      await tx.delete(metasParticipantes).where(eq(metasParticipantes.metaId, id));
      if (dados.participantes.length) await tx.insert(metasParticipantes).values(dados.participantes.map((p) => ({ ...p, metaId: id })));
      return row;
    });
    return atualizada ? this.meta(id) : null;
  }
}
