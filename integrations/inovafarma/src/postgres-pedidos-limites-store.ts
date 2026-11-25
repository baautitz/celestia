import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NomeDuplicadoError, violouChaveEstrangeira, violouRestricao } from "./erros-de-store.js";
import type { DadosRegraLimite, DadosValorLimite, RegraLimite, ValorLimite } from "./pedidos-limites.js";
import { novoIdRegraLimite, novoIdValorLimite, RegraComValoresError, RegraInexistenteError, type LimitesStore } from "./pedidos-limites-store.js";
import { returned } from "./returned.js";
import { limitesRegras, limitesValores } from "./schema.js";

const NOME_UNICO = "limites_regras_nome_unique";
const REGRA_FK = "limites_valores_regra_fk";
const r = limitesRegras;
const v = limitesValores;

export class PostgresLimitesStore implements LimitesStore {
  constructor(private readonly db: NodePgDatabase) {}

  async regras(): Promise<RegraLimite[]> {
    return this.db.select().from(r).orderBy(asc(sql`lower(${r.nome})`));
  }

  async criarRegra(dados: DadosRegraLimite): Promise<RegraLimite> {
    try {
      const [row] = await this.db.insert(r).values({ ...dados, id: novoIdRegraLimite() }).returning();
      return returned(row);
    } catch (err: unknown) {
      if (violouRestricao(err, NOME_UNICO)) throw new NomeDuplicadoError();
      throw err;
    }
  }

  async atualizarRegra(id: string, dados: DadosRegraLimite, expectedVersion: number): Promise<RegraLimite | null> {
    try {
      const [row] = await this.db
        .update(r)
        .set({ ...dados, version: expectedVersion + 1 })
        .where(and(eq(r.id, id), eq(r.version, expectedVersion)))
        .returning();
      return row ?? null;
    } catch (err: unknown) {
      if (violouRestricao(err, NOME_UNICO)) throw new NomeDuplicadoError();
      throw err;
    }
  }

  async removerRegra(id: string, expectedVersion: number): Promise<boolean> {
    try {
      const removidas = await this.db.delete(r).where(and(eq(r.id, id), eq(r.version, expectedVersion))).returning({ id: r.id });
      return removidas.length > 0;
    } catch (err: unknown) {
      if (violouChaveEstrangeira(err, REGRA_FK)) throw new RegraComValoresError();
      throw err;
    }
  }

  async valores(): Promise<ValorLimite[]> {
    return this.db.select().from(v).orderBy(desc(v.inicio), asc(v.id));
  }

  async criarValor(dados: DadosValorLimite): Promise<ValorLimite> {
    try {
      const [row] = await this.db.insert(v).values({ ...dados, id: novoIdValorLimite() }).returning();
      return returned(row);
    } catch (err: unknown) {
      if (violouChaveEstrangeira(err, REGRA_FK)) throw new RegraInexistenteError();
      throw err;
    }
  }

  async atualizarValor(id: string, dados: DadosValorLimite, expectedVersion: number): Promise<ValorLimite | null> {
    try {
      const [row] = await this.db
        .update(v)
        .set({ ...dados, version: expectedVersion + 1 })
        .where(and(eq(v.id, id), eq(v.version, expectedVersion)))
        .returning();
      return row ?? null;
    } catch (err: unknown) {
      if (violouChaveEstrangeira(err, REGRA_FK)) throw new RegraInexistenteError();
      throw err;
    }
  }

  async removerValor(id: string, expectedVersion: number): Promise<boolean> {
    const removidos = await this.db.delete(v).where(and(eq(v.id, id), eq(v.version, expectedVersion))).returning({ id: v.id });
    return removidos.length > 0;
  }
}
