import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { vinculosColaborador } from "./schema.js";
import {
  UsuarioJaVinculadoError,
  VersaoDesatualizadaError,
  type GravarVinculo,
  type VinculoColaborador,
  type VinculoStore,
} from "./vinculo-store.js";

type Row = typeof vinculosColaborador.$inferSelect;

const toRecord = (row: Row): VinculoColaborador => ({ ...row, atualizadoEm: row.atualizadoEm.toISOString() });

/** O erro do Postgres pode vir embrulhado pelo drizzle: procura na cadeia de `cause`. */
function violouUsuarioUnico(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    if ("constraint" in e && e.constraint === "vinculos_colaborador_usuario_id_unique") return true;
  }
  return false;
}

export class PostgresVinculoStore implements VinculoStore {
  constructor(private readonly db: NodePgDatabase) {}

  async list(): Promise<VinculoColaborador[]> {
    return (await this.db.select().from(vinculosColaborador)).map(toRecord);
  }

  async get(codigoColaborador: number): Promise<VinculoColaborador | null> {
    const [row] = await this.db.select().from(vinculosColaborador).where(eq(vinculosColaborador.codigoColaborador, codigoColaborador));
    return row ? toRecord(row) : null;
  }

  async gravar(input: GravarVinculo, expectedVersion: number): Promise<VinculoColaborador> {
    const atualizadoEm = new Date();
    let rows: Row[];
    try {
      rows =
        expectedVersion === 0
          ? await this.db
              .insert(vinculosColaborador)
              .values({ ...input, version: 1, atualizadoEm })
              .onConflictDoNothing({ target: vinculosColaborador.codigoColaborador })
              .returning()
          : await this.db
              .update(vinculosColaborador)
              .set({ usuarioId: input.usuarioId, atualizadoPor: input.atualizadoPor, version: expectedVersion + 1, atualizadoEm })
              .where(and(eq(vinculosColaborador.codigoColaborador, input.codigoColaborador), eq(vinculosColaborador.version, expectedVersion)))
              .returning();
    } catch (err: unknown) {
      if (violouUsuarioUnico(err)) throw new UsuarioJaVinculadoError();
      throw err;
    }
    const [row] = rows;
    if (!row) throw new VersaoDesatualizadaError();
    return toRecord(row);
  }

  async remover(codigoColaborador: number, expectedVersion: number): Promise<void> {
    const removidos = await this.db
      .delete(vinculosColaborador)
      .where(and(eq(vinculosColaborador.codigoColaborador, codigoColaborador), eq(vinculosColaborador.version, expectedVersion)))
      .returning({ codigo: vinculosColaborador.codigoColaborador });
    if (removidos.length !== 1) throw new VersaoDesatualizadaError();
  }
}
