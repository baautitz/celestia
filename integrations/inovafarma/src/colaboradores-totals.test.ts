import { describe, expect, it } from "vitest";
import { colaboradoresTotals, colaboradoresTotalsCompare } from "./colaboradores-totals";

const categoria = (quantidade: number, valor: number) => ({ quantidade, valor });
const resumo = {
  totalVendasGeral: 5000,
  totalBrutoGeral: 1000,
  totalDescontoGeral: 100,
  totalLiquidoGeral: 900,
  totalCmvGeral: 450,
  categorias: {
    vitaminas: categoria(10, 100),
    genericos: categoria(20, 200),
    similares: categoria(30, 300),
    incentivos: categoria(40, 400),
    totalFoco: categoria(90, 950),
  },
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
      "genericos-quantidade": 20,
      "genericos-valor": 200,
      "similares-quantidade": 30,
      "similares-valor": 300,
      "incentivos-quantidade": 40,
      "incentivos-valor": 400,
      "totalFoco-quantidade": 90,
      "totalFoco-valor": 950,
    });
  });

  it("não soma colunas de percentual, ticket médio nem participação", () => {
    const totals = colaboradoresTotals(resumo)!;
    for (const key of ["cmvPercent", "ticketMedio", "participacaoPercent", "cadastroPercent"]) expect(key in totals).toBe(false);
  });

  it("não devolve totais enquanto o resumo não foi carregado", () => {
    expect(colaboradoresTotals(null)).toBeUndefined();
  });
});

describe("colaboradoresTotalsCompare", () => {
  const anterior = { label: "Setembro/2026", resumo: { ...resumo, totalBrutoGeral: 800, totalDescontoGeral: 120 } };

  it("compara cada total com o do Período anterior, com a direção favorável da coluna", () => {
    const compare = colaboradoresTotalsCompare(anterior, { totalDesconto: "down" })!;
    expect(compare.totalBruto).toEqual({ previous: 800, label: "Setembro/2026", favorable: undefined });
    expect(compare.totalDesconto).toEqual({ previous: 120, label: "Setembro/2026", favorable: "down" });
    expect(compare["vitaminas-valor"]?.previous).toBe(100);
  });

  it("não compara sem Período anterior", () => {
    expect(colaboradoresTotalsCompare(null, {})).toBeUndefined();
  });
});
