import { describe, expect, it } from "vitest";
import { apurarParticipante, totaisPorColaborador, type DadosColaborador } from "./apuracao";
import type { ListaProdutos } from "./metas-store";
import type { DadosTipoMeta } from "./tipos-meta";

const tipo = (dados: Partial<DadosTipoMeta>): DadosTipoMeta => ({
  nome: "Meta",
  indicador: "foco-qtd",
  exibicao: "progresso",
  mostrarPremio: true,
  semAlvo: false,
  regra: { tipo: "fixo", valorCentavos: 10000 },
  alvoPadrao: null,
  ativo: true,
  ...dados,
});

const dados = (d: Partial<DadosColaborador> = {}): DadosColaborador => ({ indicadores: {}, produtos: {}, descontosCentavos: 0, ...d });
const ana = (alvo: number | null) => ({ codigoColaborador: 1, nome: "ANA", alvo });

describe("Apuração de um Participante", () => {
  it("em que maior é melhor, mostra quanto falta e não paga o Fixo abaixo do Alvo", () => {
    const r = apurarParticipante(tipo({}), null, ana(100), dados({ indicadores: { "foco-qtd": 80 } }));
    expect(r).toMatchObject({ realizado: 80, atingimento: 80, atingida: false, premioCentavos: 0 });
    expect(r.resultado).toBe("Qtd. Total Foco 80 de 100 un. · faltam 20");
  });

  it("em que menor é melhor, o Atingimento é Alvo ÷ Realizado e o resultado fala em p.p. abaixo", () => {
    const r = apurarParticipante(tipo({ indicador: "cmv", exibicao: "atingida" }), null, ana(30), dados({ indicadores: { cmv: 25 } }));
    expect(r).toMatchObject({ atingimento: 120, atingida: true, premioCentavos: 10000 });
    expect(r.resultado).toBe("CMV 25% · Meta: até 30% · ✓ 5 p.p. abaixo");
  });

  it("paga a maior Faixa alcançada", () => {
    const faixas = tipo({ regra: { tipo: "faixas", faixas: [{ atingimento: 100, valorCentavos: 10000 }, { atingimento: 80, valorCentavos: 5000 }, { atingimento: 120, valorCentavos: 15000 }] } });
    expect(apurarParticipante(faixas, null, ana(100), dados({ indicadores: { "foco-qtd": 110 } })).premioCentavos).toBe(10000);
    expect(apurarParticipante(faixas, null, ana(100), dados({ indicadores: { "foco-qtd": 70 } })).premioCentavos).toBe(0);
  });

  it("no Proporcional, nada abaixo do Gatilho e no máximo o Teto", () => {
    const prop = tipo({ regra: { tipo: "proporcional", valorCentavos: 10000, gatilho: 80, teto: 120 } });
    expect(apurarParticipante(prop, null, ana(100), dados({ indicadores: { "foco-qtd": 79 } })).premioCentavos).toBe(0);
    expect(apurarParticipante(prop, null, ana(100), dados({ indicadores: { "foco-qtd": 90 } })).premioCentavos).toBe(9000);
    expect(apurarParticipante(prop, null, ana(100), dados({ indicadores: { "foco-qtd": 150 } })).premioCentavos).toBe(12000);
  });

  it("no Percentual, paga a parte do Indicador em R$, só se atingir quando marcado", () => {
    const pct = (soSeAtingir: boolean) => tipo({ regra: { tipo: "percentual", percentual: 2, indicadorBase: "foco-valor", soSeAtingir } });
    const vendas = dados({ indicadores: { "foco-qtd": 50, "foco-valor": 500000 } });
    expect(apurarParticipante(pct(true), null, ana(100), vendas).premioCentavos).toBe(0);
    expect(apurarParticipante(pct(false), null, ana(100), vendas).premioCentavos).toBe(10000);
  });

  it("sem Alvo, paga a comissão sem falar em Atingida", () => {
    const comissao = tipo({ semAlvo: true, indicador: "foco-valor", regra: { tipo: "percentual", percentual: 1, indicadorBase: "foco-valor", soSeAtingir: false } });
    const r = apurarParticipante(comissao, null, ana(null), dados({ indicadores: { "foco-valor": 300000 } }));
    expect(r).toMatchObject({ atingimento: null, atingida: null, premioCentavos: 3000, resultado: "Valor Total Foco R$ 3.000,00" });
  });

  it("com o Alvo pendente, não paga e avisa", () => {
    const r = apurarParticipante(tipo({}), null, ana(null), dados({ indicadores: { "foco-qtd": 80 } }));
    expect(r).toMatchObject({ atingimento: null, atingida: false, premioCentavos: 0, resultado: "Qtd. Total Foco 80 un. · Alvo pendente" });
  });

  it("na Lista de Produtos, conta os produtos batidos com o ajuste do Colaborador e o mínimo", () => {
    const lista: ListaProdutos = {
      produtos: [
        { produtoId: "a", nome: "A", quantidade: 10 },
        { produtoId: "b", nome: "B", quantidade: 5 },
        { produtoId: "c", nome: "C", quantidade: 5 },
      ],
      minimo: 2,
      ajustes: [{ codigoColaborador: 1, produtoId: "a", quantidade: 4 }],
    };
    const r = apurarParticipante(tipo({ indicador: "lista-produtos", exibicao: "contagem" }), lista, ana(null), dados({ produtos: { a: 4, b: 5, c: 1 } }));
    expect(r).toMatchObject({ realizado: 2, atingida: true, premioCentavos: 10000, resultado: "2 de 3 produtos batidos · mínimo 2" });
  });

  it("na Meta de Avaliações, o Saldo é o valor inicial menos os descontos, nunca negativo, e é o Prêmio", () => {
    const av = tipo({ indicador: "avaliacoes", regra: { tipo: "saldo" } });
    expect(apurarParticipante(av, null, ana(20000), dados({ descontosCentavos: 5000 }))).toMatchObject({ realizado: 15000, atingida: true, premioCentavos: 15000 });
    expect(apurarParticipante(av, null, ana(20000), dados({ descontosCentavos: 25000 }))).toMatchObject({ realizado: 0, atingida: false, premioCentavos: 0 });
  });
});

describe("total de Prêmios por Colaborador", () => {
  it("soma os Prêmios de todas as Metas", () => {
    const linhas = [
      { codigoColaborador: 1, nome: "ANA", premioCentavos: 100 },
      { codigoColaborador: 2, nome: "BIA", premioCentavos: 50 },
      { codigoColaborador: 1, nome: "ANA", premioCentavos: 30 },
    ];
    expect(totaisPorColaborador(linhas)).toEqual([
      { codigoColaborador: 1, nome: "ANA", premioCentavos: 130 },
      { codigoColaborador: 2, nome: "BIA", premioCentavos: 50 },
    ]);
  });
});
