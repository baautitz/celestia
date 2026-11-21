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

  it("não edita nem cancela de novo um Pedido cancelado", async () => {
    const store = new MemoryPedidoStore();
    const p = await store.criar(dados, autor);
    expect(await store.cancelarRascunho(p.id, 1)).toMatchObject({ status: "cancelado", version: 2 });
    expect(await store.atualizarRascunho(p.id, dados, 2)).toBeNull();
    expect(await store.cancelarRascunho(p.id, 2)).toBeNull();
  });
});
