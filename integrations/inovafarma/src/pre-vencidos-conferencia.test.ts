import { describe, expect, it } from "vitest";
import { conferir, type LancamentoParaConferir, type VendaParaConferir } from "./pre-vencidos-conferencia.js";

const lanc = (codigoColaborador: number, produtoId: string, quantidade: number, validade = "2027-03"): LancamentoParaConferir => ({
  codigoColaborador,
  nomeColaborador: `Colab ${codigoColaborador}`,
  produtoId,
  nomeProduto: `Produto ${produtoId}`,
  quantidade,
  validade,
});
const venda = (codigoColaborador: number, produtoId: string, quantidade: number): VendaParaConferir => ({ codigoColaborador, produtoId, quantidade });

describe("conferir lançamentos de Pré-vencidos com as vendas", () => {
  it("fica verde quando o vendido é igual ou maior que o lançado", () => {
    const [linha] = conferir([lanc(1, "a", 5), lanc(1, "b", 2)], [venda(1, "a", 5), venda(1, "b", 9)]);
    expect(linha).toMatchObject({ codigoColaborador: 1, produtos: 2, quantidadeLancada: 7, quantidadeVendida: 14, produtosConformes: 2, situacao: "verde" });
  });

  it("fica vermelho quando algum produto vendeu menos que o lançado", () => {
    const [linha] = conferir([lanc(1, "a", 5), lanc(1, "b", 2)], [venda(1, "a", 5), venda(1, "b", 1)]);
    expect(linha).toMatchObject({ produtosConformes: 1, situacao: "vermelho" });
    expect(linha?.detalhe.map((d) => [d.produtoId, d.situacao])).toEqual([["a", "verde"], ["b", "vermelho"]]);
  });

  it("soma os lançamentos do mesmo produto, ignorando a validade", () => {
    const [linha] = conferir([lanc(1, "a", 3, "2027-03"), lanc(1, "a", 4, "2027-05")], [venda(1, "a", 6)]);
    expect(linha?.detalhe).toHaveLength(1);
    expect(linha?.detalhe[0]).toMatchObject({ quantidadeLancada: 7, quantidadeVendida: 6, situacao: "vermelho", validades: ["2027-03", "2027-05"] });
  });

  it("sem venda do produto no período fica vermelho com vendido zero", () => {
    const [linha] = conferir([lanc(1, "a", 1)], []);
    expect(linha?.detalhe[0]).toMatchObject({ quantidadeVendida: 0, situacao: "vermelho" });
  });

  it("separa por Colaborador, sem misturar as vendas de outro", () => {
    const linhas = conferir([lanc(1, "a", 2), lanc(2, "a", 2)], [venda(1, "a", 2), venda(2, "a", 1)]);
    expect(linhas.map((l) => [l.codigoColaborador, l.situacao])).toEqual([[1, "verde"], [2, "vermelho"]]);
  });
});
