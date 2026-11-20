import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NomeDuplicadoError, violouRestricao } from "./erros-de-store.js";
import { tiposMeta } from "./schema.js";
import type { DadosTipoMeta, TipoMeta } from "./tipos-meta.js";
import { novoIdTipoMeta, type TipoMetaStore } from "./tipos-meta-store.js";
import { returned } from "./returned.js";

type TipoRow = typeof tiposMeta.$inferSelect;

const NOME_UNICO = "tipos_meta_nome_unique";

const tipo = (row: TipoRow): TipoMeta => ({ ...row, criadoEm: row.criadoEm.toISOString(), atualizadoEm: row.atualizadoEm.toISOString() });

export class PostgresTipoMetaStore implements TipoMetaStore {
  constructor(private readonly db: NodePgDatabase) {}

  async listar(): Promise<TipoMeta[]> {
    return (await this.db.select().from(tiposMeta).orderBy(asc(tiposMeta.nome))).map(tipo);
  }

  async tipo(id: string): Promise<TipoMeta | null> {
    const [row] = await this.db.select().from(tiposMeta).where(eq(tiposMeta.id, id));
    return row ? tipo(row) : null;
  }

  async criar(dados: DadosTipoMeta): Promise<TipoMeta> {
    try {
      const [row] = await this.db.insert(tiposMeta).values({ ...dados, id: novoIdTipoMeta() }).returning();
      return tipo(returned(row));
    } catch (err: unknown) {
      if (violouRestricao(err, NOME_UNICO)) throw new NomeDuplicadoError();
      throw err;
    }
  }

  async atualizar(id: string, dados: DadosTipoMeta, expectedVersion: number): Promise<TipoMeta | null> {
    const t = tiposMeta;
    try {
      const [row] = await this.db
        .update(t)
        .set({ ...dados, version: expectedVersion + 1, atualizadoEm: new Date() })
        .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
        .returning();
      return row ? tipo(row) : null;
    } catch (err: unknown) {
      if (violouRestricao(err, NOME_UNICO)) throw new NomeDuplicadoError();
      throw err;
    }
  }
}
