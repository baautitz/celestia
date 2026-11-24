import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Cotacao, CotacaoStore } from "./cotacao-store.js";
import { pedidosCotacoes } from "./schema.js";

type Row = typeof pedidosCotacoes.$inferSelect;
const cotacao = (row: Row): Cotacao => ({ ...row, importadoEm: row.importadoEm?.toISOString() ?? null });

export class PostgresCotacaoStore implements CotacaoStore {
  constructor(private readonly db: NodePgDatabase) {}

  async listar(pedidoId: string): Promise<Cotacao[]> {
    const t = pedidosCotacoes;
    return (await this.db.select().from(t).where(eq(t.pedidoId, pedidoId)).orderBy(asc(t.ordem))).map(cotacao);
  }

  async criar(pedidoId: string, codigosFornecedor: number[]): Promise<Cotacao[]> {
    const rows = await this.db.insert(pedidosCotacoes).values(codigosFornecedor.map((codigoFornecedor, ordem) => ({ pedidoId, codigoFornecedor, ordem }))).returning();
    return rows.map(cotacao);
  }

  async acrescentar(pedidoId: string, codigosFornecedor: number[]): Promise<Cotacao[]> {
    const lista = await this.listar(pedidoId);
    const novos = codigosFornecedor.filter((c) => !lista.some((x) => x.codigoFornecedor === c));
    if (novos.length === 0) return lista;
    await this.db.insert(pedidosCotacoes).values(novos.map((codigoFornecedor, i) => ({ pedidoId, codigoFornecedor, ordem: lista.length + i })));
    return this.listar(pedidoId);
  }

  async definirQuantidades(pedidoId: string, codigoFornecedor: number, quantidades: Record<string, number>): Promise<void> {
    const t = pedidosCotacoes;
    await this.db
      .update(t)
      .set({ quantidades: sql`coalesce(${t.quantidades}, '{}'::jsonb) || ${JSON.stringify(quantidades)}::jsonb` })
      .where(and(eq(t.pedidoId, pedidoId), eq(t.codigoFornecedor, codigoFornecedor)));
  }

  async gravarPrecos(pedidoId: string, codigoFornecedor: number, precos: Record<string, number | null>, quantidades: Record<string, number>, expectedVersion: number): Promise<Cotacao | null> {
    const t = pedidosCotacoes;
    const [row] = await this.db
      .update(t)
      .set({ precos, quantidades, importadoEm: new Date(), version: expectedVersion + 1 })
      .where(and(eq(t.pedidoId, pedidoId), eq(t.codigoFornecedor, codigoFornecedor), eq(t.version, expectedVersion)))
      .returning();
    return row ? cotacao(row) : null;
  }
}
