import { describe, expect, it } from "vitest";
import { vinculoDoUsuario } from "./metas-comum";
import { MemoryVinculoStore } from "./vinculo-store";

const gravar = (store: MemoryVinculoStore, codigoColaborador: number, usuarioId: string | null, version: number, lojas: number[] = []) =>
  store.gravar({ codigoColaborador, usuarioId, lojas, atualizadoPor: "autor" }, version);

describe("MemoryVinculoStore.porUsuario", () => {
  it("acha o vínculo do Usuário, e null para quem não tem", async () => {
    const store = new MemoryVinculoStore();
    await gravar(store, 7, "ana", 0, [1]);
    await gravar(store, 9, "bia", 0, [2]);
    expect(await store.porUsuario("bia")).toMatchObject({ codigoColaborador: 9, usuarioId: "bia", lojas: [2] });
    expect(await store.porUsuario("zeca")).toBeNull();
  });
});

describe("vinculoDoUsuario", () => {
  it("devolve o vínculo em vigor e ignora o desfeito", async () => {
    const store = new MemoryVinculoStore();
    await gravar(store, 7, "ana", 0, [1]);
    expect(await vinculoDoUsuario(store, "ana")).toMatchObject({ codigoColaborador: 7 });
    await store.desfazer(7, 1, "autor");
    expect(await vinculoDoUsuario(store, "ana")).toBeNull();
  });
});
