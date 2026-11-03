import { describe, expect, it } from "vitest";
import { calcularBaixas, type ItemParaBaixa, type VendaParaBaixa } from "./baixas-pre-vencidos.js";

const item = (id: string, quantidade: number, validade: string, incluidoEm = "2027-04-01 08:00:00", produtoId = "dipirona"): ItemParaBaixa => ({ id, produtoId, validade, quantidade, incluidoEm });
const venda = (vendaId: number, data: string, quantidade: number, extra: Partial<VendaParaBaixa> = {}): VendaParaBaixa => ({
  vendaId,
  data,
  codigoColaborador: 7,
  produtoId: "dipirona",
  quantidade,
  cancelada: false,
  ...extra,
});

describe("Baixas de Pré-vencido", () => {
  it("a venda gasta primeiro a validade mais próxima, e o resto vai para a seguinte", () => {
    const { baixas, restante } = calcularBaixas({
      itens: [item("junho", 3, "2027-06"), item("maio", 2, "2027-05")],
      vendas: [venda(1, "2027-04-02 10:00:00", 4)],
    });
    expect(baixas).toEqual([{ venda: venda(1, "2027-04-02 10:00:00", 4), quantidade: 4, itens: [{ itemId: "maio", quantidade: 2 }, { itemId: "junho", quantidade: 2 }] }]);
    expect(restante).toEqual({ maio: 0, junho: 1 });
  });

  it("entre Itens de mesma validade, gasta primeiro o incluído antes", () => {
    const { restante } = calcularBaixas({
      itens: [item("depois", 2, "2027-06", "2027-04-01 09:00:00"), item("antes", 2, "2027-06", "2027-04-01 08:00:00")],
      vendas: [venda(1, "2027-04-02 10:00:00", 1)],
    });
    expect(restante).toEqual({ antes: 1, depois: 2 });
  });

  it("uma venda feita antes da inclusão do Item não o gasta", () => {
    const { baixas, restante } = calcularBaixas({
      itens: [item("a", 2, "2027-06", "2027-04-10 12:00:00")],
      vendas: [venda(1, "2027-04-10 11:59:59", 1), venda(2, "2027-04-10 12:00:00", 1)],
    });
    expect(baixas.map((b) => [b.venda.vendaId, b.quantidade])).toEqual([[2, 1]]);
    expect(restante).toEqual({ a: 1 });
  });

  it("uma venda só gasta os Itens já incluídos, mesmo que um incluído depois tenha validade mais próxima", () => {
    const { restante } = calcularBaixas({
      itens: [item("junho", 5, "2027-06", "2027-04-01 08:00:00"), item("maio", 5, "2027-05", "2027-04-05 08:00:00")],
      vendas: [venda(1, "2027-04-02 10:00:00", 1), venda(2, "2027-04-06 10:00:00", 1)],
    });
    expect(restante).toEqual({ junho: 4, maio: 4 });
  });

  it("continua gastando o Item depois da validade, até zerar, e a venda que sobra não baixa nada", () => {
    const { baixas, restante } = calcularBaixas({
      itens: [item("a", 2, "2027-04")],
      vendas: [venda(1, "2027-06-15 10:00:00", 1), venda(2, "2027-07-01 10:00:00", 3), venda(3, "2027-07-02 10:00:00", 1)],
    });
    expect(baixas.map((b) => [b.venda.vendaId, b.quantidade])).toEqual([[1, 1], [2, 1]]);
    expect(restante).toEqual({ a: 0 });
  });

  it("uma venda cancelada não baixa, e a quantidade fica para as vendas seguintes", () => {
    const { baixas, restante } = calcularBaixas({
      itens: [item("a", 2, "2027-06")],
      vendas: [venda(1, "2027-04-02 10:00:00", 2, { cancelada: true }), venda(2, "2027-04-03 10:00:00", 2, { codigoColaborador: 8 })],
    });
    expect(baixas.map((b) => [b.venda.vendaId, b.venda.codigoColaborador, b.quantidade])).toEqual([[2, 8, 2]]);
    expect(restante).toEqual({ a: 0 });
  });

  it("só gasta Itens do produto vendido, e as vendas são consideradas na ordem da data", () => {
    const { baixas, restante } = calcularBaixas({
      itens: [item("a", 1, "2027-06"), item("b", 1, "2027-06", "2027-04-01 08:00:00", "amoxicilina")],
      vendas: [venda(2, "2027-04-03 10:00:00", 1, { codigoColaborador: 8 }), venda(1, "2027-04-02 10:00:00", 1)],
    });
    expect(baixas.map((b) => [b.venda.vendaId, b.venda.codigoColaborador])).toEqual([[1, 7]]);
    expect(restante).toEqual({ a: 0, b: 1 });
  });

  it("com estado congelado, parte do Restante congelado e ignora as vendas até o congelamento, mesmo as canceladas depois", () => {
    const { baixas, restante } = calcularBaixas({
      itens: [item("maio", 5, "2027-05"), item("junho", 4, "2027-06"), item("novo", 2, "2027-05", "2027-05-02 08:00:00")],
      vendas: [venda(1, "2027-04-20 10:00:00", 3, { cancelada: true }), venda(2, "2027-05-03 10:00:00", 3)],
      congelado: { ate: "2027-04-30 23:59:59", restante: { maio: 1, junho: 4 } },
    });
    expect(baixas.map((b) => [b.venda.vendaId, b.itens])).toEqual([
      [2, [{ itemId: "maio", quantidade: 1 }, { itemId: "novo", quantidade: 2 }]],
    ]);
    expect(restante).toEqual({ maio: 0, junho: 4, novo: 0 });
  });
});
