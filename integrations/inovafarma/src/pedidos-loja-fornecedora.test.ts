import { describe, expect, it } from "vitest";
import { conferir } from "./pedidos-conferencia";
import { DadosPedido, semLinhasDeLoja, soDeLojas } from "./pedidos";
import { itensDaLojaFornecedora, itensDoFornecedor, itensDoFornecedorPorLoja } from "./pedido-pdf";

const item = (quantidades: Record<string, unknown>[]) => ({ produtoId: "p", nome: "Dipirona", codigoBarra: null, quantidades });
const misto = DadosPedido.parse({ itens: [item([{ codigoLoja: 1, quantidade: 5, codigosFornecedor: [7] }, { codigoLoja: 2, quantidade: 3, lojasFornecedoras: [{ codigoLoja: 1, quantidade: 3 }] }])] });

describe("Pedido a uma Loja", () => {
  it("recusa a Loja fornecendo a si mesma ou mais do que o pedido na linha", () => {
    expect(DadosPedido.safeParse({ itens: [item([{ codigoLoja: 1, quantidade: 1, lojasFornecedoras: [{ codigoLoja: 1, quantidade: 3 }] }])] }).success).toBe(false);
    expect(DadosPedido.safeParse({ itens: [item([{ codigoLoja: 1, quantidade: 1, lojasFornecedoras: [{ codigoLoja: 2, quantidade: 2 }] }])] }).success).toBe(false);
  });

  it("fica fora da cotação e do PDF da distribuidora, e sai no PDF da Loja por destino", () => {
    expect(semLinhasDeLoja(misto).itens[0]?.quantidades.map((q) => q.codigoLoja)).toEqual([1]);
    expect(itensDoFornecedor({ ...misto, escolhas: { p: 7 } }, 7, { p: 2 })).toEqual([{ nome: "Dipirona", quantidade: 5, preco: 2 }]);
    expect(itensDaLojaFornecedora(misto, 1, (n) => `Loja ${n}`)).toEqual([{ loja: "Loja 2", itens: [{ nome: "Dipirona", quantidade: 3 }] }]);
    expect(soDeLojas(misto)).toBe(false);
  });

  it("entra na conferência mesmo sem fornecedor escolhido", () => {
    expect(conferir({ ...misto, escolhas: {} }, new Map([["p|2", 3]]))).toEqual([
      { produtoId: "p", nome: "Dipirona", codigoLoja: 2, pedida: 3, recebida: 3, estado: "recebido" },
    ]);
  });

  it("o produto dividido leva a cada distribuidora as parcelas dela, por Loja", () => {
    const pedido = { ...misto, escolhas: { p: [{ codigoLoja: 1, codigoFornecedor: 7, quantidade: 4 }, { codigoLoja: 1, codigoFornecedor: 9, quantidade: 1 }] } };
    expect(itensDoFornecedor(pedido, 9, { p: 2 })).toEqual([{ nome: "Dipirona", quantidade: 1, preco: 2 }]);
    expect(itensDoFornecedorPorLoja(pedido, 7, { p: 2 }, (n) => `Loja ${n}`)).toEqual([{ loja: "Loja 1", itens: [{ nome: "Dipirona", quantidade: 4, preco: 2 }] }]);
  });

  it("a distribuidora com quantidade definida recebe ela; a vazia, o restante depois das Lojas", () => {
    const pedido = DadosPedido.parse({ itens: [item([{ codigoLoja: 1, quantidade: 10, codigosFornecedor: [7, 9], quantidadesDistribuidoras: [{ codigoFornecedor: 7, quantidade: 5 }], lojasFornecedoras: [{ codigoLoja: 2, quantidade: 2 }] }])] });
    const pedidas = (codigo: number) => itensDoFornecedor({ ...pedido, escolhas: { p: codigo } }, codigo, { p: 1 })[0]?.quantidade;
    expect([pedidas(7), pedidas(9)]).toEqual([5, 3]);
  });
});
