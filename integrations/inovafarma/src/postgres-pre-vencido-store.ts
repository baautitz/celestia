import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { preVencidosLancamentos } from "./schema.js";
import { novoId, type FiltroLancamentos, type LancamentoPreVencido, type NovoLancamento, type PreVencidoStore } from "./pre-vencidos-store.js";

type Row = typeof preVencidosLancamentos.$inferSelect;

const toRecord = (row: Row): LancamentoPreVencido => ({ ...row, criadoEm: row.criadoEm.toISOString(), atualizadoEm: row.atualizadoEm.toISOString() });

export class PostgresPreVencidoStore implements PreVencidoStore {
  constructor(private readonly db: NodePgDatabase) {}

  async criar(novo: NovoLancamento): Promise<LancamentoPreVencido> {
    const [row] = await this.db.insert(preVencidosLancamentos).values({ ...novo, id: novoId() }).returning();
    return toRecord(row!);
  }

  async listar({ periodoId, codigoColaborador, codigoLoja }: FiltroLancamentos): Promise<LancamentoPreVencido[]> {
    const t = preVencidosLancamentos;
    const filtros = [eq(t.periodoId, periodoId)];
    if (codigoColaborador !== undefined) filtros.push(eq(t.codigoColaborador, codigoColaborador));
    if (codigoLoja !== undefined) filtros.push(eq(t.codigoLoja, codigoLoja));
    return (await this.db.select().from(t).where(and(...filtros)).orderBy(desc(t.criadoEm))).map(toRecord);
  }

  async get(id: string): Promise<LancamentoPreVencido | null> {
    const [row] = await this.db.select().from(preVencidosLancamentos).where(eq(preVencidosLancamentos.id, id));
    return row ? toRecord(row) : null;
  }

  async atualizar(id: string, valores: { quantidade: number; validade: string }, expectedVersion: number): Promise<LancamentoPreVencido | null> {
    const t = preVencidosLancamentos;
    const [row] = await this.db
      .update(t)
      .set({ ...valores, version: expectedVersion + 1, atualizadoEm: new Date() })
      .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async excluir(id: string, expectedVersion: number): Promise<boolean> {
    const t = preVencidosLancamentos;
    const rows = await this.db.delete(t).where(and(eq(t.id, id), eq(t.version, expectedVersion))).returning({ id: t.id });
    return rows.length > 0;
  }
}
