import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CorrecaoDuplicadaError, novoIdCorrecao, type CorrecaoBaixa, type CorrecaoBaixaStore, type EdicaoCorrecaoBaixa, type NovaCorrecaoBaixa } from "./correcoes-baixa-store.js";
import { preVencidosCorrecoesBaixa } from "./schema.js";

type Row = typeof preVencidosCorrecoesBaixa.$inferSelect;

const toRecord = (row: Row): CorrecaoBaixa => ({ ...row, criadoEm: row.criadoEm.toISOString(), atualizadoEm: row.atualizadoEm.toISOString() });

export class PostgresCorrecaoBaixaStore implements CorrecaoBaixaStore {
  constructor(private readonly db: NodePgDatabase) {}

  async criar(nova: NovaCorrecaoBaixa): Promise<CorrecaoBaixa> {
    const [row] = await this.db.insert(preVencidosCorrecoesBaixa).values({ ...nova, id: novoIdCorrecao() }).onConflictDoNothing().returning();
    if (!row) throw new CorrecaoDuplicadaError();
    return toRecord(row);
  }

  async get(id: string): Promise<CorrecaoBaixa | null> {
    const [row] = await this.db.select().from(preVencidosCorrecoesBaixa).where(eq(preVencidosCorrecoesBaixa.id, id));
    return row ? toRecord(row) : null;
  }

  async daLoja(codigoLoja: number): Promise<CorrecaoBaixa[]> {
    return (await this.db.select().from(preVencidosCorrecoesBaixa).where(eq(preVencidosCorrecoesBaixa.codigoLoja, codigoLoja))).map(toRecord);
  }

  async atualizar(id: string, valores: EdicaoCorrecaoBaixa, expectedVersion: number): Promise<CorrecaoBaixa | null> {
    const t = preVencidosCorrecoesBaixa;
    const [row] = await this.db
      .update(t)
      .set({ ...valores, version: expectedVersion + 1, atualizadoEm: new Date() })
      .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async excluir(id: string, expectedVersion: number): Promise<boolean> {
    const t = preVencidosCorrecoesBaixa;
    const rows = await this.db.delete(t).where(and(eq(t.id, id), eq(t.version, expectedVersion))).returning({ id: t.id });
    return rows.length > 0;
  }
}
