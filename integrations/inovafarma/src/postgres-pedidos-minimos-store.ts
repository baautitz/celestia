import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { MinimoMaximo, MinimoMaximoStore, ValoresMinimoMaximo } from "./pedidos-minimos-store.js";
import { pedidosMinimos } from "./schema.js";

const linha = ({ produtoId, codigoLoja, minimo, maximo, version }: typeof pedidosMinimos.$inferSelect): MinimoMaximo => ({ produtoId, codigoLoja, minimo, maximo, version });

export class PostgresMinimoMaximoStore implements MinimoMaximoStore {
  constructor(private readonly db: NodePgDatabase) {}

  async listar(): Promise<MinimoMaximo[]> {
    return (await this.db.select().from(pedidosMinimos)).map(linha);
  }

  async definir(produtoId: string, codigoLoja: number, valores: ValoresMinimoMaximo, expectedVersion: number): Promise<MinimoMaximo | null> {
    const t = pedidosMinimos;
    if (expectedVersion === 0) {
      const [row] = await this.db.insert(t).values({ produtoId, codigoLoja, ...valores }).onConflictDoNothing().returning();
      return row ? linha(row) : null;
    }
    const [row] = await this.db
      .update(t)
      .set({ ...valores, version: expectedVersion + 1, atualizadoEm: new Date() })
      .where(and(eq(t.produtoId, produtoId), eq(t.codigoLoja, codigoLoja), eq(t.version, expectedVersion)))
      .returning();
    return row ? linha(row) : null;
  }
}
