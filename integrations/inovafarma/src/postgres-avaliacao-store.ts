import { and, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { avaliacoes } from "./schema.js";
import { novoIdAvaliacao, type Avaliacao, type AvaliacaoStore, type EdicaoAvaliacao, type FiltroAvaliacoes, type NovaAvaliacao } from "./avaliacoes-store.js";

type Row = typeof avaliacoes.$inferSelect;

const toRecord = (row: Row): Avaliacao => ({ ...row, criadoEm: row.criadoEm.toISOString(), atualizadoEm: row.atualizadoEm.toISOString() });

export class PostgresAvaliacaoStore implements AvaliacaoStore {
  constructor(private readonly db: NodePgDatabase) {}

  async criar(nova: NovaAvaliacao): Promise<Avaliacao> {
    const [row] = await this.db.insert(avaliacoes).values({ ...nova, id: novoIdAvaliacao() }).returning();
    return toRecord(row!);
  }

  async listar({ periodoId, codigoColaborador, lojas }: FiltroAvaliacoes): Promise<Avaliacao[]> {
    if (lojas?.length === 0) return [];
    const t = avaliacoes;
    const filtros = [eq(t.periodoId, periodoId)];
    if (codigoColaborador !== undefined) filtros.push(eq(t.codigoColaborador, codigoColaborador));
    if (lojas !== undefined) filtros.push(inArray(t.codigoLoja, lojas));
    return (await this.db.select().from(t).where(and(...filtros)).orderBy(desc(t.criadoEm))).map(toRecord);
  }

  async get(id: string): Promise<Avaliacao | null> {
    const [row] = await this.db.select().from(avaliacoes).where(eq(avaliacoes.id, id));
    return row ? toRecord(row) : null;
  }

  async atualizar(id: string, valores: EdicaoAvaliacao, expectedVersion: number): Promise<Avaliacao | null> {
    const t = avaliacoes;
    const [row] = await this.db
      .update(t)
      .set({ ...valores, version: expectedVersion + 1, atualizadoEm: new Date() })
      .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async excluir(id: string, expectedVersion: number): Promise<boolean> {
    const t = avaliacoes;
    const rows = await this.db.delete(t).where(and(eq(t.id, id), eq(t.version, expectedVersion))).returning({ id: t.id });
    return rows.length > 0;
  }
}
