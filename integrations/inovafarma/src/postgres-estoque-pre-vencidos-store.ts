import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { preVencidosItens } from "./schema.js";
import { novoIdItem, type EstoquePreVencidoStore, type ItemPreVencido, type NovoItemPreVencido } from "./estoque-pre-vencidos-store.js";

type Row = typeof preVencidosItens.$inferSelect;

const toRecord = (row: Row): ItemPreVencido => ({
  ...row,
  incluidoEm: row.incluidoEm.toISOString(),
  criadoEm: row.criadoEm.toISOString(),
  atualizadoEm: row.atualizadoEm.toISOString(),
});

export class PostgresEstoquePreVencidoStore implements EstoquePreVencidoStore {
  constructor(private readonly db: NodePgDatabase) {}

  async criar(novo: NovoItemPreVencido): Promise<ItemPreVencido> {
    const [row] = await this.db
      .insert(preVencidosItens)
      .values({ ...novo, id: novoIdItem(), incluidoEm: new Date(novo.incluidoEm) })
      .returning();
    return toRecord(row!);
  }

  async listar(codigoLoja: number): Promise<ItemPreVencido[]> {
    const t = preVencidosItens;
    return (await this.db.select().from(t).where(eq(t.codigoLoja, codigoLoja)).orderBy(asc(t.incluidoEm), asc(t.criadoEm), asc(t.id))).map(toRecord);
  }

  async lojas(): Promise<number[]> {
    const t = preVencidosItens;
    return (await this.db.selectDistinct({ codigoLoja: t.codigoLoja }).from(t).orderBy(asc(t.codigoLoja))).map((r) => r.codigoLoja);
  }

  async get(id: string): Promise<ItemPreVencido | null> {
    const [row] = await this.db.select().from(preVencidosItens).where(eq(preVencidosItens.id, id));
    return row ? toRecord(row) : null;
  }

  async atualizar(id: string, valores: { quantidade: number; validade: string }, expectedVersion: number): Promise<ItemPreVencido | null> {
    const t = preVencidosItens;
    const [row] = await this.db
      .update(t)
      .set({ ...valores, version: expectedVersion + 1, atualizadoEm: new Date() })
      .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async excluir(id: string, expectedVersion: number): Promise<boolean> {
    const t = preVencidosItens;
    const rows = await this.db.delete(t).where(and(eq(t.id, id), eq(t.version, expectedVersion))).returning({ id: t.id });
    return rows.length > 0;
  }
}
