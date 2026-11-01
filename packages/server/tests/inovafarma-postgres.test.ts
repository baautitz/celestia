import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { runModuleMigrations } from "@platform/core/migrations";
import { INOVAFARMA_MIGRATIONS, PostgresVinculoStore, UsuarioJaVinculadoError, VersaoDesatualizadaError } from "@integrations/inovafarma/server";
import { createTestPool, dbTestsEnabled } from "./helpers/test-db.js";

describe.skipIf(!dbTestsEnabled)("Vínculos do Colaborador contra Postgres real", () => {
  let pool: Pool;
  let db: NodePgDatabase;
  let store: PostgresVinculoStore;

  beforeAll(async () => {
    pool = createTestPool();
    db = drizzle({ client: pool });
    await runModuleMigrations(db, [{ moduleId: "inovafarma", ...INOVAFARMA_MIGRATIONS }]);
    store = new PostgresVinculoStore(db);
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE inovafarma.vinculos_colaborador`);
  });
  afterAll(async () => {
    await pool?.end();
  });

  const gravar = (codigoColaborador: number, usuarioId: string | null, version: number) =>
    store.gravar({ codigoColaborador, usuarioId, atualizadoPor: "autor" }, version);

  it("cria, altera incrementando a version, lista e desfaz", async () => {
    expect(await gravar(7, "ana", 0)).toMatchObject({ codigoColaborador: 7, usuarioId: "ana", version: 1, atualizadoPor: "autor" });
    expect(await gravar(7, "bia", 1)).toMatchObject({ usuarioId: "bia", version: 2 });
    expect((await store.get(7))?.usuarioId).toBe("bia");
    expect(await store.list()).toHaveLength(1);

    await store.remover(7, 2);
    expect(await store.get(7)).toBeNull();
  });

  it("recusa a version desatualizada ao criar, alterar e desfazer", async () => {
    await gravar(7, "ana", 0);
    await expect(gravar(7, "bia", 0)).rejects.toBeInstanceOf(VersaoDesatualizadaError);
    await expect(gravar(7, "bia", 5)).rejects.toBeInstanceOf(VersaoDesatualizadaError);
    await expect(store.remover(7, 5)).rejects.toBeInstanceOf(VersaoDesatualizadaError);
    expect((await store.get(7))?.usuarioId).toBe("ana");
  });

  it("garante no banco um Usuário em no máximo um vínculo, ao criar e ao alterar", async () => {
    await gravar(7, "ana", 0);
    await gravar(9, "bia", 0);
    await expect(gravar(11, "ana", 0)).rejects.toBeInstanceOf(UsuarioJaVinculadoError);
    await expect(gravar(9, "ana", 1)).rejects.toBeInstanceOf(UsuarioJaVinculadoError);
  });

  it("aceita vários vínculos sem Usuário, para a #78 gravar só Lojas", async () => {
    await gravar(7, null, 0);
    await gravar(9, null, 0);
    expect(await store.list()).toHaveLength(2);
  });

  it("não há FK entre o vínculo e iam.users", async () => {
    const fks = await db.execute(sql`
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'inovafarma' AND constraint_type = 'FOREIGN KEY'
    `);
    expect(fks.rows).toEqual([]);
  });
});
