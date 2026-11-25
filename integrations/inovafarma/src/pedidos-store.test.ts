import { describe, expect, it } from "vitest";
import { MemoryPedidoStore } from "./pedidos-store";

const dados = { itens: [{ produtoId: "p-1", nome: "AAS", codigoBarra: null, quantidades: [{ codigoLoja: 1, quantidade: 3 }] }] };
const autor = { id: "u1", nome: "Gil" };

describe("Store de Pedidos", () => {
  it("só muda o rascunho na versão esperada e incrementa a versão", async () => {
    const store = new MemoryPedidoStore();
    const p = await store.criar(dados, autor);
    expect(await store.atualizarRascunho(p.id, dados, 5)).toBeNull();
    expect(await store.atualizarRascunho(p.id, dados, 1)).toMatchObject({ version: 2, status: "rascunho" });
  });

  it("confirma só um Pedido cotado e na versão esperada, e registra o recebimento depois", async () => {
    const store = new MemoryPedidoStore();
    const p = await store.criar(dados, autor);
    expect(await store.confirmar(p.id, { "p-1": 7 }, 1)).toBeNull();
    await store.iniciarCotacao(p.id, 1);
    await store.marcarCotado(p.id);
    expect(await store.confirmar(p.id, { "p-1": 7 }, 1)).toBeNull();
    expect(await store.confirmar(p.id, { "p-1": 7 }, 3)).toMatchObject({ status: "confirmado", escolhas: { "p-1": 7 }, version: 4 });
    expect(await store.registrarRecebimento(p.id, "recebido")).toMatchObject({ status: "recebido" });
    expect(await store.registrarRecebimento("nada", "recebido")).toBeNull();
  });

  it("cancela o Pedido em cotação, mas não o confirmado", async () => {
    const store = new MemoryPedidoStore();
    const emCotacao = await store.criar(dados, autor);
    await store.iniciarCotacao(emCotacao.id, 1);
    expect(await store.cancelar(emCotacao.id, 2)).toMatchObject({ status: "cancelado" });
    const confirmado = await store.criar(dados, autor);
    await store.iniciarCotacao(confirmado.id, 1);
    await store.marcarCotado(confirmado.id);
    await store.confirmar(confirmado.id, { "p-1": 7 }, 3);
    expect(await store.cancelar(confirmado.id, 4)).toBeNull();
  });

  it("não edita nem cancela de novo um Pedido cancelado", async () => {
    const store = new MemoryPedidoStore();
    const p = await store.criar(dados, autor);
    expect(await store.cancelar(p.id, 1)).toMatchObject({ status: "cancelado", version: 2 });
    expect(await store.atualizarRascunho(p.id, dados, 2)).toBeNull();
    expect(await store.cancelar(p.id, 2)).toBeNull();
  });
});
