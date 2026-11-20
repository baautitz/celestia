import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { runModuleMigrations } from "@platform/core/migrations";
import {
  INOVAFARMA_MIGRATIONS,
  NomeDuplicadoError,
  PostgresFuroEstoqueStore,
  PostgresTipoMetaStore,
  PostgresVinculoStore,
  UsuarioJaVinculadoError,
  VersaoDesatualizadaError,
} from "@integrations/inovafarma/server";
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

  const gravar = (codigoColaborador: number, usuarioId: string | null, version: number, lojas: number[] = []) =>
    store.gravar({ codigoColaborador, usuarioId, lojas, atualizadoPor: "autor" }, version);

  it("cria, altera incrementando a version, lista e desfaz", async () => {
    expect(await gravar(7, "ana", 0)).toMatchObject({ codigoColaborador: 7, usuarioId: "ana", version: 1, atualizadoPor: "autor" });
    expect(await gravar(7, "bia", 1)).toMatchObject({ usuarioId: "bia", version: 2 });
    expect((await store.get(7))?.usuarioId).toBe("bia");
    expect(await store.list()).toHaveLength(1);

    await store.desfazer(7, 2, "outro");
    expect(await store.get(7)).toMatchObject({ usuarioId: null, lojas: [], version: 3, atualizadoPor: "outro" });
  });

  it("desfazer mantém a linha com a version: recriar exige a version nova e o Usuário fica livre", async () => {
    await gravar(7, "ana", 0, [1]);
    expect(await store.desfazer(7, 1, "autor")).toMatchObject({ usuarioId: null, lojas: [], version: 2 });
    await expect(gravar(7, "ana", 0)).rejects.toBeInstanceOf(VersaoDesatualizadaError);
    await expect(gravar(7, "ana", 1)).rejects.toBeInstanceOf(VersaoDesatualizadaError);
    expect(await gravar(9, "ana", 0)).toMatchObject({ usuarioId: "ana", version: 1 });
    expect(await gravar(7, "bia", 2, [2])).toMatchObject({ usuarioId: "bia", lojas: [2], version: 3 });
  });

  it("não desfaz um vínculo que nunca existiu", async () => {
    await expect(store.desfazer(7, 0, "autor")).rejects.toBeInstanceOf(VersaoDesatualizadaError);
  });

  it("recusa a version desatualizada ao criar, alterar e desfazer", async () => {
    await gravar(7, "ana", 0);
    await expect(gravar(7, "bia", 0)).rejects.toBeInstanceOf(VersaoDesatualizadaError);
    await expect(gravar(7, "bia", 5)).rejects.toBeInstanceOf(VersaoDesatualizadaError);
    await expect(store.desfazer(7, 5, "autor")).rejects.toBeInstanceOf(VersaoDesatualizadaError);
    expect((await store.get(7))?.usuarioId).toBe("ana");
  });

  it("garante no banco um Usuário em no máximo um vínculo, ao criar e ao alterar", async () => {
    await gravar(7, "ana", 0);
    await gravar(9, "bia", 0);
    await expect(gravar(11, "ana", 0)).rejects.toBeInstanceOf(UsuarioJaVinculadoError);
    await expect(gravar(9, "ana", 1)).rejects.toBeInstanceOf(UsuarioJaVinculadoError);
  });

  it("grava várias Lojas em vínculos sem Usuário, sem Usuário repetido", async () => {
    await gravar(7, null, 0, [1, 2]);
    await gravar(9, null, 0, [2]);
    expect((await store.list()).map((v) => v.lojas).sort((a, b) => b.length - a.length)).toEqual([[1, 2], [2]]);
  });

  it("altera as Lojas pelo compare-and-set e aceita ficar sem nenhuma", async () => {
    await gravar(7, "ana", 0, [1, 2, 3]);
    expect(await gravar(7, "ana", 1, [3])).toMatchObject({ lojas: [3], version: 2 });
    await expect(gravar(7, "ana", 1, [9])).rejects.toBeInstanceOf(VersaoDesatualizadaError);
    expect((await store.get(7))?.lojas).toEqual([3]);
    expect(await gravar(7, "ana", 2, [])).toMatchObject({ lojas: [], version: 3 });
  });

  it("acha o vínculo do Usuário pelo índice único, sem varrer a lista, e não acha quem não tem", async () => {
    await gravar(7, "ana", 0, [1]);
    await gravar(9, "bia", 0, [2]);
    expect(await store.porUsuario("bia")).toMatchObject({ codigoColaborador: 9, usuarioId: "bia", lojas: [2] });
    expect(await store.porUsuario("zeca")).toBeNull();
    await store.desfazer(7, 1, "autor");
    expect(await store.porUsuario("ana")).toBeNull();
  });

  it("não há FK entre o vínculo e iam.users", async () => {
    const fks = await db.execute(sql`
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'inovafarma' AND table_name = 'vinculos_colaborador' AND constraint_type = 'FOREIGN KEY'
    `);
    expect(fks.rows).toEqual([]);
  });
});

describe.skipIf(!dbTestsEnabled)("Nomes únicos de Tipo de Meta e de Motivo contra Postgres real", () => {
  let pool: Pool;
  let db: NodePgDatabase;
  let tipos: PostgresTipoMetaStore;
  let furo: PostgresFuroEstoqueStore;

  beforeAll(async () => {
    pool = createTestPool();
    db = drizzle({ client: pool });
    await runModuleMigrations(db, [{ moduleId: "inovafarma", ...INOVAFARMA_MIGRATIONS }]);
    tipos = new PostgresTipoMetaStore(db);
    furo = new PostgresFuroEstoqueStore(db);
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE inovafarma.tipos_meta, inovafarma.metas, inovafarma.motivos_ajuste, inovafarma.justificativas_ajuste CASCADE`);
  });
  afterAll(async () => {
    await pool?.end();
  });

  const dados = (nome: string) => ({
    nome,
    indicador: "cmv" as const,
    exibicao: "atingida" as const,
    mostrarPremio: true,
    semAlvo: false,
    regra: { tipo: "fixo" as const, valorCentavos: 10000 },
    alvoPadrao: 30,
    lista: null,
    ativo: true,
  });

  it("recusa o Tipo de Meta de mesmo nome, sem diferenciar maiúsculas, ao criar e ao alterar", async () => {
    await tipos.criar(dados("CMV"));
    await expect(tipos.criar(dados("cmv"))).rejects.toBeInstanceOf(NomeDuplicadoError);
    const outro = await tipos.criar(dados("Ticket"));
    await expect(tipos.atualizar(outro.id, dados("Cmv"), outro.version)).rejects.toBeInstanceOf(NomeDuplicadoError);
    expect(await tipos.atualizar(outro.id, dados("Ticket Médio"), outro.version)).toMatchObject({ nome: "Ticket Médio", version: 2 });
  });

  it("recusa o Motivo de mesmo nome, sem diferenciar maiúsculas, ao criar e ao alterar", async () => {
    await furo.criarMotivo("Vencido");
    await expect(furo.criarMotivo("VENCIDO")).rejects.toBeInstanceOf(NomeDuplicadoError);
    const outro = await furo.criarMotivo("Troca");
    await expect(furo.atualizarMotivo(outro.id, { nome: "vencido", ativo: true }, outro.version)).rejects.toBeInstanceOf(NomeDuplicadoError);
    expect(await furo.atualizarMotivo(outro.id, { nome: "Troca de lote", ativo: false }, outro.version)).toMatchObject({ nome: "Troca de lote", ativo: false });
  });
});
