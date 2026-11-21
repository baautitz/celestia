import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NomeDuplicadoError, violouRestricao } from "./erros-de-store.js";
import type { DadosVisaoPedidos, VisaoPedidos } from "./pedidos-visoes.js";
import { novoIdVisaoPedidos, type PedidosVisoesStore } from "./pedidos-visoes-store.js";
import { returned } from "./returned.js";
import { pedidosVisoes } from "./schema.js";

const NOME_UNICO = "pedidos_visoes_usuario_nome_unique";
const t = pedidosVisoes;

export class PostgresPedidosVisoesStore implements PedidosVisoesStore {
  constructor(private readonly db: NodePgDatabase) {}

  async listar(usuarioId: string): Promise<VisaoPedidos[]> {
    return this.db.select().from(t).where(eq(t.usuarioId, usuarioId)).orderBy(asc(sql`lower(${t.nome})`));
  }

  async visao(usuarioId: string, id: string): Promise<VisaoPedidos | null> {
    const [row] = await this.db.select().from(t).where(and(eq(t.id, id), eq(t.usuarioId, usuarioId)));
    return row ?? null;
  }

  async criar(usuarioId: string, dados: DadosVisaoPedidos): Promise<VisaoPedidos> {
    const id = novoIdVisaoPedidos();
    try {
      return await this.db.transaction(async (tx) => {
        if (dados.padrao) await tx.update(t).set({ padrao: false, version: sql`${t.version} + 1` }).where(and(eq(t.usuarioId, usuarioId), eq(t.padrao, true)));
        const [row] = await tx.insert(t).values({ ...dados, id, usuarioId }).returning();
        return returned(row);
      });
    } catch (err: unknown) {
      if (violouRestricao(err, NOME_UNICO)) throw new NomeDuplicadoError();
      throw err;
    }
  }

  async atualizar(usuarioId: string, id: string, dados: DadosVisaoPedidos, expectedVersion: number): Promise<VisaoPedidos | null> {
    try {
      return await this.db.transaction(async (tx) => {
        const [atual] = await tx.select({ id: t.id }).from(t).where(and(eq(t.id, id), eq(t.usuarioId, usuarioId), eq(t.version, expectedVersion))).for("update");
        if (!atual) return null;
        if (dados.padrao) await tx.update(t).set({ padrao: false, version: sql`${t.version} + 1` }).where(and(eq(t.usuarioId, usuarioId), eq(t.padrao, true), ne(t.id, id)));
        const [row] = await tx
          .update(t)
          .set({ ...dados, version: expectedVersion + 1 })
          .where(eq(t.id, id))
          .returning();
        return row ?? null;
      });
    } catch (err: unknown) {
      if (violouRestricao(err, NOME_UNICO)) throw new NomeDuplicadoError();
      throw err;
    }
  }

  async remover(usuarioId: string, id: string, expectedVersion: number): Promise<boolean> {
    const removidas = await this.db.delete(t).where(and(eq(t.id, id), eq(t.usuarioId, usuarioId), eq(t.version, expectedVersion))).returning({ id: t.id });
    return removidas.length > 0;
  }
}
