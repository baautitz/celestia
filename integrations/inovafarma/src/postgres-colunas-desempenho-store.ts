import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ColunaDesempenho, DadosColunaDesempenho } from "./colunas-desempenho.js";
import { novoIdColuna, type ColunaDesempenhoStore } from "./colunas-desempenho-store.js";
import { NomeDuplicadoError, violouRestricao } from "./erros-de-store.js";
import { returned } from "./returned.js";
import { colunasDesempenho } from "./schema.js";

type ColunaRow = typeof colunasDesempenho.$inferSelect;

const NOME_UNICO = "colunas_desempenho_nome_unique";

const coluna = (row: ColunaRow): ColunaDesempenho => ({ ...row, criadoEm: row.criadoEm.toISOString(), atualizadoEm: row.atualizadoEm.toISOString() });

export class PostgresColunaDesempenhoStore implements ColunaDesempenhoStore {
  constructor(private readonly db: NodePgDatabase) {}

  async listar(): Promise<ColunaDesempenho[]> {
    return (await this.db.select().from(colunasDesempenho).orderBy(asc(colunasDesempenho.ordem), asc(colunasDesempenho.nome))).map(coluna);
  }

  async coluna(id: string): Promise<ColunaDesempenho | null> {
    const [row] = await this.db.select().from(colunasDesempenho).where(eq(colunasDesempenho.id, id));
    return row ? coluna(row) : null;
  }

  async criar(dados: DadosColunaDesempenho): Promise<ColunaDesempenho> {
    const t = colunasDesempenho;
    try {
      const [row] = await this.db
        .insert(t)
        .values({ ...dados, id: novoIdColuna(), ordem: sql`(SELECT COALESCE(MAX(${t.ordem}), 0) + 1 FROM ${t})` })
        .returning();
      return coluna(returned(row));
    } catch (err: unknown) {
      if (violouRestricao(err, NOME_UNICO)) throw new NomeDuplicadoError();
      throw err;
    }
  }

  async atualizar(id: string, dados: DadosColunaDesempenho, expectedVersion: number): Promise<ColunaDesempenho | null> {
    const t = colunasDesempenho;
    try {
      const [row] = await this.db
        .update(t)
        .set({ ...dados, version: expectedVersion + 1, atualizadoEm: new Date() })
        .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
        .returning();
      return row ? coluna(row) : null;
    } catch (err: unknown) {
      if (violouRestricao(err, NOME_UNICO)) throw new NomeDuplicadoError();
      throw err;
    }
  }

  async remover(id: string, expectedVersion: number): Promise<boolean> {
    const t = colunasDesempenho;
    const removidas = await this.db.delete(t).where(and(eq(t.id, id), eq(t.version, expectedVersion))).returning({ id: t.id });
    return removidas.length > 0;
  }
}
