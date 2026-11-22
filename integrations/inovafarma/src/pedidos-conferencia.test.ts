import { describe, expect, it } from "vitest";
import { aChegarPorLinha, conferir, estadoDaLinha, statusDoPedido } from "./pedidos-conferencia";
import type { Pedido } from "./pedidos";

const pedido = (itens: Pedido["itens"], escolhas: Pedido["escolhas"]): Pick<Pedido, "itens" | "escolhas"> => ({ itens, escolhas });
const dipirona = { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: null, quantidades: [{ codigoLoja: 1, quantidade: 10 }, { codigoLoja: 2, quantidade: 4 }] };
const aas = { produtoId: "p-2", nome: "AAS", codigoBarra: null, quantidades: [{ codigoLoja: 1, quantidade: 3 }] };

describe("Estado da linha do Pedido na conferência com a NF", () => {
  it("é pendente sem entrada, parcial abaixo do pedido, recebido no exato e excedente acima", () => {
    expect(estadoDaLinha(10, 0)).toBe("pendente");
    expect(estadoDaLinha(10, 4)).toBe("parcial");
    expect(estadoDaLinha(10, 10)).toBe("recebido");
    expect(estadoDaLinha(10, 12)).toBe("excedente");
  });
});

describe("Conferência do Pedido com as entradas de NF", () => {
  const p = pedido([dipirona, aas], { "p-1": 9, "p-2": 7 });

  it("confere cada produto escolhido por Loja contra o que entrou", () => {
    const linhas = conferir(p, new Map([["p-1|1", 10], ["p-1|2", 1], ["p-2|1", 5]]));
    expect(linhas).toEqual([
      { produtoId: "p-1", nome: "DIPIRONA", codigoLoja: 1, pedida: 10, recebida: 10, estado: "recebido" },
      { produtoId: "p-1", nome: "DIPIRONA", codigoLoja: 2, pedida: 4, recebida: 1, estado: "parcial" },
      { produtoId: "p-2", nome: "AAS", codigoLoja: 1, pedida: 3, recebida: 5, estado: "excedente" },
    ]);
  });

  it("ignora produto sem fornecedor escolhido e linha com quantidade zero", () => {
    const sem = pedido([dipirona, { ...aas, quantidades: [{ codigoLoja: 1, quantidade: 0 }] }], { "p-1": 9 });
    expect(conferir(sem, new Map()).map((l) => l.produtoId)).toEqual(["p-1", "p-1"]);
  });

  it("leva o Pedido a recebido, parcialmente recebido ou o mantém confirmado", () => {
    expect(statusDoPedido(conferir(p, new Map([["p-1|1", 10], ["p-1|2", 4], ["p-2|1", 3]])))).toBe("recebido");
    expect(statusDoPedido(conferir(p, new Map([["p-1|1", 10]])))).toBe("parcialmente_recebido");
    expect(statusDoPedido(conferir(p, new Map()))).toBe("confirmado");
  });

  it("a chegar é o pedido em aberto menos as entradas, nunca negativo", () => {
    const linhas = conferir(p, new Map([["p-1|1", 10], ["p-1|2", 1], ["p-2|1", 5]]));
    expect(aChegarPorLinha(linhas)).toEqual(new Map([["p-1|2", 3]]));
  });
});
