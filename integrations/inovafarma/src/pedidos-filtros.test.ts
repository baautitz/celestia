import { describe, expect, it } from "vitest";
import { filtrarPedidos, SEM_FILTROS } from "./pedidos-filtros";
import type { Pedido } from "./pedido-rascunho-window";

const pedido = (id: string, status: Pedido["status"], lojaFornecedora?: number): Pedido => ({
  id,
  status,
  criadoPorNome: "Gil",
  version: 1,
  criadoEm: "2027-04-10T15:00:00Z",
  itens: [{ produtoId: id, nome: id, codigoBarra: null, quantidades: [{ codigoLoja: 1, quantidade: 5, codigosFornecedor: [7], ...(lojaFornecedora ? { lojasFornecedoras: [{ codigoLoja: lojaFornecedora, quantidade: 1 }] } : {}) }] }],
});
const todos = [pedido("a", "rascunho"), pedido("b", "confirmado", 3)];
const ids = (parte: Partial<typeof SEM_FILTROS>, produtos: Set<string> | null = null) => filtrarPedidos(todos, { ...SEM_FILTROS, ...parte }, produtos).map((p) => p.id);

describe("filtros da aba Pedidos", () => {
  it("combina situação, período, Loja de destino, fornecedor e produto", () => {
    expect(ids({})).toEqual(["a", "b"]);
    expect(ids({ situacoes: ["confirmado"] })).toEqual(["b"]);
    expect(ids({ periodo: { de: "2027-04-11", ate: "2027-04-12" } })).toEqual([]);
    expect(ids({ lojas: [2] })).toEqual([]);
    expect(ids({ fornecedor: -3 })).toEqual(["b"]);
    expect(ids({ entradas: [{ tipo: "grupo", id: "1", nome: "G" }] }, new Set(["a"]))).toEqual(["a"]);
  });
});
