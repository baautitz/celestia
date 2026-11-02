import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ApuracaoPeriodo, ApuracaoStore } from "./apuracao-store.js";
import { apuracoesMetas } from "./schema.js";

export class PostgresApuracaoStore implements ApuracaoStore {
  constructor(private readonly db: NodePgDatabase) {}

  async apuracao(periodoId: string): Promise<ApuracaoPeriodo | null> {
    const [row] = await this.db.select().from(apuracoesMetas).where(eq(apuracoesMetas.periodoId, periodoId));
    return row ? { periodoId: row.periodoId, metas: row.metas, apuradoEm: row.apuradoEm.toISOString() } : null;
  }

  async gravar({ periodoId, metas, apuradoEm }: ApuracaoPeriodo): Promise<void> {
    const valores = { metas, apuradoEm: new Date(apuradoEm) };
    await this.db.insert(apuracoesMetas).values({ periodoId, ...valores }).onConflictDoUpdate({ target: apuracoesMetas.periodoId, set: valores });
  }

  async descartar(periodoId: string): Promise<void> {
    await this.db.delete(apuracoesMetas).where(eq(apuracoesMetas.periodoId, periodoId));
  }
}
