import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DadosPedido, Pedido, PedidoStatus } from "./pedidos.js";
import { novoIdPedido, type PedidoStore } from "./pedidos-store.js";
import { returned } from "./returned.js";
import { pedidos } from "./schema.js";

type PedidoRow = typeof pedidos.$inferSelect;

const pedido = (row: PedidoRow): Pedido => ({ ...row, status: row.status as PedidoStatus, criadoEm: row.criadoEm.toISOString(), atualizadoEm: row.atualizadoEm.toISOString() });

export class PostgresPedidoStore implements PedidoStore {
  constructor(private readonly db: NodePgDatabase) {}

  async listar(): Promise<Pedido[]> {
    return (await this.db.select().from(pedidos).orderBy(desc(pedidos.criadoEm))).map(pedido);
  }

  async pedido(id: string): Promise<Pedido | null> {
    const [row] = await this.db.select().from(pedidos).where(eq(pedidos.id, id));
    return row ? pedido(row) : null;
  }

  async criar(dados: DadosPedido, autor: { id: string; nome: string }): Promise<Pedido> {
    const [row] = await this.db.insert(pedidos).values({ id: novoIdPedido(), status: "rascunho", itens: dados.itens, criadoPorId: autor.id, criadoPorNome: autor.nome }).returning();
    return pedido(returned(row));
  }

  async atualizarRascunho(id: string, dados: DadosPedido, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, { itens: dados.itens });
  }

  async cancelarRascunho(id: string, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, { status: "cancelado" });
  }

  private async mudar(id: string, expectedVersion: number, mudancas: Partial<PedidoRow>): Promise<Pedido | null> {
    const t = pedidos;
    const [row] = await this.db
      .update(t)
      .set({ ...mudancas, version: expectedVersion + 1, atualizadoEm: new Date() })
      .where(and(eq(t.id, id), eq(t.version, expectedVersion), eq(t.status, "rascunho")))
      .returning();
    return row ? pedido(row) : null;
  }
}
