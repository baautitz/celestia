import { describe, expect, it } from "vitest";
import { gerarPdf, itensDoFornecedorPorLoja, linhasPorLoja } from "./pedido-pdf";

const pedido = {
  itens: [
    { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", quantidades: [{ codigoLoja: 1, quantidade: 10, codigosFornecedor: [7] }, { codigoLoja: 2, quantidade: 5, codigosFornecedor: [8] }] },
    { produtoId: "p-2", nome: "AAS", codigoBarra: null, quantidades: [{ codigoLoja: 1, quantidade: 3, codigosFornecedor: [7] }, { codigoLoja: 2, quantidade: 0, codigosFornecedor: [7] }] },
  ],
  escolhas: { "p-1": 7, "p-2": 7 },
};

describe("Pedido por Loja", () => {
  it("separa as quantidades por Loja, só as da distribuidora e só as maiores que zero", () => {
    expect(linhasPorLoja(pedido, 7).map((l) => `${l.codigoLoja}:${l.produtoId}:${l.quantidade}`)).toEqual(["1:p-1:10", "1:p-2:3"]);
  });

  it("agrupa os itens com preço por Loja, na ordem do código", () => {
    const lojas = itensDoFornecedorPorLoja(pedido, 7, { "p-1": 2, "p-2": null }, (c) => `Loja ${c}`);
    expect(lojas).toEqual([{ loja: "Loja 1", itens: [{ nome: "DIPIRONA", quantidade: 10, preco: 2 }] }]);
  });

  it("gera o PDF com uma página por Loja", async () => {
    const pdf = await gerarPdf({ fornecedor: "ALFA", data: "23/11/2026", itens: [], lojas: [{ loja: "A", itens: [{ nome: "X", quantidade: 1, preco: 1 }] }, { loja: "B", itens: [{ nome: "Y", quantidade: 2, preco: 1 }] }] });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(2);
  });
});
