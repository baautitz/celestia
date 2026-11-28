import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { violouRestricao } from "./erros-de-store.js";
import type { DadosFalteiro, EdicaoFalteiro, Falta } from "./pedidos-falteiro.js";
import { FaltaDuplicadaError, novoIdFalteiro, type FalteiroStore } from "./pedidos-falteiro-store.js";
import { returned } from "./returned.js";
import { pedidosFalteiro } from "./schema.js";

const SLOT_UNICO = "pedidos_falteiro_produto_loja_unique";
const t = pedidosFalteiro;
type Row = typeof pedidosFalteiro.$inferSelect;

const toFalta = (row: Row): Falta => ({
  ...row,
  criadoEm: row.criadoEm.toISOString(),
  atualizadoEm: row.atualizadoEm.toISOString(),
});

export class PostgresFalteiroStore implements FalteiroStore {
  constructor(private readonly db: NodePgDatabase) {}

  async listar(): Promise<Falta[]> {
    return (await this.db.select().from(t).orderBy(desc(t.criadoEm), desc(t.id))).map(toFalta);
  }

  async get(id: string): Promise<Falta | null> {
    const [row] = await this.db.select().from(t).where(eq(t.id, id));
    return row ? toFalta(row) : null;
  }

  async criar(dados: DadosFalteiro, autor: { id: string; nome: string }): Promise<Falta> {
    try {
      const [row] = await this.db
        .insert(t)
        .values({
          id: novoIdFalteiro(),
          produtoId: dados.produtoId,
          codigoLoja: dados.codigoLoja,
          quantidade: dados.quantidade,
          observacao: dados.observacao,
          criadoPorId: autor.id,
          criadoPorNome: autor.nome,
        })
        .returning();
      return toFalta(returned(row));
    } catch (err: unknown) {
      if (violouRestricao(err, SLOT_UNICO)) throw new FaltaDuplicadaError();
      throw err;
    }
  }

  async atualizar(id: string, dados: EdicaoFalteiro, expectedVersion: number): Promise<Falta | null> {
    try {
      const [row] = await this.db
        .update(t)
        .set({
          codigoLoja: dados.codigoLoja,
          quantidade: dados.quantidade,
          observacao: dados.observacao,
          version: expectedVersion + 1,
          atualizadoEm: new Date(),
        })
        .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
        .returning();
      return row ? toFalta(row) : null;
    } catch (err: unknown) {
      if (violouRestricao(err, SLOT_UNICO)) throw new FaltaDuplicadaError();
      throw err;
    }
  }

  async remover(id: string, expectedVersion: number): Promise<boolean> {
    const removidas = await this.db
      .delete(t)
      .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
      .returning({ id: t.id });
    return removidas.length > 0;
  }
}
