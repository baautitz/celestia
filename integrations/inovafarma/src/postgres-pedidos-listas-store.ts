import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NomeDuplicadoError, violouRestricao } from "./erros-de-store.js";
import type { DadosListaPedidos, ListaPedidos } from "./pedidos-listas.js";
import { novoIdListaPedidos, type PedidosListasStore } from "./pedidos-listas-store.js";
import { returned } from "./returned.js";
import { pedidosListas } from "./schema.js";

type ListaRow = typeof pedidosListas.$inferSelect;

const NOME_UNICO = "pedidos_listas_nome_unique";

const lista = (row: ListaRow): ListaPedidos => ({ ...row, criadoEm: row.criadoEm.toISOString(), atualizadoEm: row.atualizadoEm.toISOString() });

export class PostgresPedidosListasStore implements PedidosListasStore {
  constructor(private readonly db: NodePgDatabase) {}

  async listar(): Promise<ListaPedidos[]> {
    return (await this.db.select().from(pedidosListas).orderBy(asc(sql`lower(${pedidosListas.nome})`))).map(lista);
  }

  async lista(id: string): Promise<ListaPedidos | null> {
    const [row] = await this.db.select().from(pedidosListas).where(eq(pedidosListas.id, id));
    return row ? lista(row) : null;
  }

  async criar(dados: DadosListaPedidos): Promise<ListaPedidos> {
    try {
      const [row] = await this.db.insert(pedidosListas).values({ ...dados, id: novoIdListaPedidos() }).returning();
      return lista(returned(row));
    } catch (err: unknown) {
      if (violouRestricao(err, NOME_UNICO)) throw new NomeDuplicadoError();
      throw err;
    }
  }

  async atualizar(id: string, dados: DadosListaPedidos, expectedVersion: number): Promise<ListaPedidos | null> {
    const t = pedidosListas;
    try {
      const [row] = await this.db
        .update(t)
        .set({ ...dados, version: expectedVersion + 1, atualizadoEm: new Date() })
        .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
        .returning();
      return row ? lista(row) : null;
    } catch (err: unknown) {
      if (violouRestricao(err, NOME_UNICO)) throw new NomeDuplicadoError();
      throw err;
    }
  }

  async remover(id: string, expectedVersion: number): Promise<boolean> {
    const t = pedidosListas;
    const removidas = await this.db.delete(t).where(and(eq(t.id, id), eq(t.version, expectedVersion))).returning({ id: t.id });
    return removidas.length > 0;
  }
}
