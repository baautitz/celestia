import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DadosPedido, Escolhas, Pedido, PedidoStatus } from "./pedidos.js";
import { novoIdPedido, type PedidoStore } from "./pedidos-store.js";
import { returned } from "./returned.js";
import { pedidos } from "./schema.js";

type PedidoRow = typeof pedidos.$inferSelect;

const pedido = (row: PedidoRow): Pedido => ({ ...row, status: row.status as PedidoStatus, confirmadoEm: row.confirmadoEm?.toISOString() ?? null, criadoEm: row.criadoEm.toISOString(), atualizadoEm: row.atualizadoEm.toISOString() });

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
    return this.mudar(id, expectedVersion, { itens: dados.itens }, ["rascunho", "aguardando_precos", "cotado"]);
  }

  async cancelar(id: string, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, { status: "cancelado" }, ["rascunho", "aguardando_precos", "cotado"]);
  }

  async iniciarCotacao(id: string, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, { status: "aguardando_precos" });
  }

  async marcarCotado(id: string): Promise<Pedido | null> {
    return this.mudar(id, undefined, { status: "cotado" }, "aguardando_precos");
  }

  async confirmar(id: string, escolhas: Escolhas, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, { status: "confirmado", escolhas, confirmadoEm: new Date() }, "cotado");
  }

  async confirmarSemCotacao(id: string, expectedVersion: number): Promise<Pedido | null> {
    return this.mudar(id, expectedVersion, { status: "confirmado", escolhas: {}, confirmadoEm: new Date() }, ["rascunho", "aguardando_precos", "cotado"]);
  }

  async registrarRecebimento(id: string, status: "confirmado" | "parcialmente_recebido" | "recebido"): Promise<Pedido | null> {
    return this.mudar(id, undefined, { status }, ["confirmado", "parcialmente_recebido", "recebido"]);
  }

  private async mudar(id: string, expectedVersion: number | undefined, mudancas: Partial<PedidoRow>, de: PedidoStatus | PedidoStatus[] = "rascunho"): Promise<Pedido | null> {
    const t = pedidos;
    const [row] = await this.db
      .update(t)
      .set({ ...mudancas, version: sql`${t.version} + 1`, atualizadoEm: new Date() })
      .where(and(eq(t.id, id), inArray(t.status, ([] as PedidoStatus[]).concat(de)), expectedVersion === undefined ? undefined : eq(t.version, expectedVersion)))
      .returning();
    return row ? pedido(row) : null;
  }
}
