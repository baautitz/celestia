import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { BaixasCongeladas, BaixasCongeladasStore } from "./baixas-congeladas-store.js";
import { preVencidosBaixasCongeladas } from "./schema.js";

type Row = typeof preVencidosBaixasCongeladas.$inferSelect;

const toRecord = (row: Row): BaixasCongeladas => ({ ...row, congeladoEm: row.congeladoEm.toISOString() });

export class PostgresBaixasCongeladasStore implements BaixasCongeladasStore {
  constructor(private readonly db: NodePgDatabase) {}

  async doPeriodo(periodoId: string): Promise<BaixasCongeladas[]> {
    const t = preVencidosBaixasCongeladas;
    return (await this.db.select().from(t).where(eq(t.periodoId, periodoId))).map(toRecord);
  }

  async daLoja(codigoLoja: number): Promise<BaixasCongeladas[]> {
    const t = preVencidosBaixasCongeladas;
    return (await this.db.select().from(t).where(eq(t.codigoLoja, codigoLoja)).orderBy(asc(t.ate))).map(toRecord);
  }

  async gravar(periodoId: string, congeladas: BaixasCongeladas[]): Promise<void> {
    const t = preVencidosBaixasCongeladas;
    await this.db.transaction(async (tx) => {
      await tx.delete(t).where(eq(t.periodoId, periodoId));
      if (congeladas.length > 0) await tx.insert(t).values(congeladas.map((c) => ({ ...c, periodoId, congeladoEm: new Date(c.congeladoEm) })));
    });
  }

  async descartar(periodoId: string): Promise<void> {
    await this.db.delete(preVencidosBaixasCongeladas).where(eq(preVencidosBaixasCongeladas.periodoId, periodoId));
  }
}
