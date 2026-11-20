import { describe, expect, it } from "vitest";
import { colaboradoresTotals, colaboradoresTotalsCompare } from "./colaboradores-totals";
import { defined } from "./test/defined";

const coluna = (id: string, quantidade: number, valor: number) => ({ id, quantidade, valor, cmv: valor / 2 });
const resumo = {
  totalVendasGeral: 5000,
  totalBrutoGeral: 1000,
  totalDescontoGeral: 100,
  totalLiquidoGeral: 900,
  totalCmvGeral: 450,
  colunas: [coluna("vitaminas", 10, 100), coluna("genericos", 20, 200), coluna("totalFoco", 90, 950)],
};

describe("colaboradoresTotals", () => {
  it("leva os totais do resumo para todas as colunas somáveis da tabela de Colaboradores", () => {
    expect(colaboradoresTotals(resumo)).toEqual({
      quantidadeVendas: 5000,
      totalBruto: 1000,
      totalDesconto: 100,
      totalLiquido: 900,
      totalCmv: 450,
      "vitaminas-quantidade": 10,
      "vitaminas-valor": 100,
      "vitaminas-cmv": 50,
      "genericos-quantidade": 20,
      "genericos-valor": 200,
      "genericos-cmv": 100,
      "totalFoco-quantidade": 90,
      "totalFoco-valor": 950,
      "totalFoco-cmv": 475,
    });
  });

  it("não soma colunas de percentual, ticket médio nem participação", () => {
    const totals = defined(colaboradoresTotals(resumo), "the totals");
    for (const key of ["cmvPercent", "ticketMedio", "participacaoPercent", "cadastroPercent"]) expect(key in totals).toBe(false);
  });

  it("não devolve totais enquanto o resumo não foi carregado", () => {
    expect(colaboradoresTotals(null)).toBeUndefined();
  });
});

describe("colaboradoresTotalsCompare", () => {
  const anterior = { label: "Setembro/2026", resumo: { ...resumo, totalBrutoGeral: 800, totalDescontoGeral: 120 } };

  it("compara cada total com o do Período anterior, com a direção favorável da coluna", () => {
    const compare = defined(colaboradoresTotalsCompare(anterior, { totalDesconto: "down" }), "the comparison");
    expect(compare.totalBruto).toEqual({ previous: 800, label: "Setembro/2026", favorable: undefined });
    expect(compare.totalDesconto).toEqual({ previous: 120, label: "Setembro/2026", favorable: "down" });
    expect(compare["vitaminas-valor"]?.previous).toBe(100);
  });

  it("não compara sem Período anterior", () => {
    expect(colaboradoresTotalsCompare(null, {})).toBeUndefined();
  });
});
