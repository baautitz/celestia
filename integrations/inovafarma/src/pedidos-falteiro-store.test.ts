import { describe, expect, it } from "vitest";
import { FaltaDuplicadaError, MemoryFalteiroStore } from "./pedidos-falteiro-store.js";

const autor = { id: "u1", nome: "Ana" };

describe("Store do Falteiro", () => {
  it("cria, lista do mais recente para o mais antigo e busca por id", async () => {
    const store = new MemoryFalteiroStore();
    const f1 = await store.criar({ produtoId: "p-1", codigoLoja: 1, quantidade: 3, observacao: "Cliente pediu" }, autor);
    const f2 = await store.criar({ produtoId: "p-2", codigoLoja: null, quantidade: null, observacao: null }, autor);
    expect(f1).toMatchObject({
      produtoId: "p-1",
      codigoLoja: 1,
      quantidade: 3,
      observacao: "Cliente pediu",
      criadoPorId: "u1",
      criadoPorNome: "Ana",
      version: 1,
    });
    expect(await store.get(f1.id)).toEqual(f1);
    expect((await store.listar()).map((f) => f.id)).toEqual([f2.id, f1.id]);
  });

  it("garante no máximo um registro ativo por (produtoId, codigoLoja), tratando codigoLoja = null como slot único", async () => {
    const store = new MemoryFalteiroStore();
    await store.criar({ produtoId: "p-1", codigoLoja: 1, quantidade: 2, observacao: null }, autor);
    await store.criar({ produtoId: "p-1", codigoLoja: 2, quantidade: 5, observacao: null }, autor);
    await store.criar({ produtoId: "p-1", codigoLoja: null, quantidade: 10, observacao: "Todas as Lojas" }, autor);

    await expect(store.criar({ produtoId: "p-1", codigoLoja: 1, quantidade: 4, observacao: null }, autor)).rejects.toBeInstanceOf(FaltaDuplicadaError);
    await expect(store.criar({ produtoId: "p-1", codigoLoja: null, quantidade: 1, observacao: null }, autor)).rejects.toBeInstanceOf(FaltaDuplicadaError);
  });

  it("edita e remove com controle de concorrência otimista (version), liberando o slot após remover", async () => {
    const store = new MemoryFalteiroStore();
    const f = await store.criar({ produtoId: "p-1", codigoLoja: 1, quantidade: 2, observacao: "Inicial" }, autor);

    expect(await store.atualizar(f.id, { codigoLoja: 1, quantidade: 5, observacao: "Atualizado" }, 99)).toBeNull();
    const editada = await store.atualizar(f.id, { codigoLoja: 1, quantidade: 5, observacao: "Atualizado" }, 1);
    expect(editada).toMatchObject({ codigoLoja: 1, quantidade: 5, observacao: "Atualizado", version: 2 });

    await store.criar({ produtoId: "p-1", codigoLoja: null, quantidade: null, observacao: null }, autor);
    await expect(store.atualizar(f.id, { codigoLoja: null, quantidade: 5, observacao: null }, 2)).rejects.toBeInstanceOf(FaltaDuplicadaError);

    expect(await store.remover(f.id, 1)).toBe(false);
    expect(await store.remover(f.id, 2)).toBe(true);
    expect(await store.get(f.id)).toBeNull();

    const recriada = await store.criar({ produtoId: "p-1", codigoLoja: 1, quantidade: 1, observacao: null }, autor);
    expect(recriada.version).toBe(1);
  });
});
