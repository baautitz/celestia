import { describe, expect, it } from "vitest";
import { descreverPremio, problemaDoTipo, type DadosTipoMeta } from "./tipos-meta";

const tipo = (dados: Partial<DadosTipoMeta>): DadosTipoMeta => ({
  nome: "CMV",
  indicador: "cmv",
  exibicao: "atingida",
  mostrarPremio: true,
  semAlvo: false,
  regra: { tipo: "fixo", valorCentavos: 10000 },
  alvoPadrao: null,
  ativo: true,
  ...dados,
});

describe("prévia do Prêmio", () => {
  it("mostra as Faixas de um Indicador em que menor é melhor na unidade do Indicador", () => {
    const cmv = tipo({ alvoPadrao: 30, regra: { tipo: "faixas", faixas: [{ atingimento: 111.12, valorCentavos: 15000 }, { atingimento: 100, valorCentavos: 10000 }] } });
    expect(descreverPremio(cmv)).toBe("CMV % até 30% paga R$ 100,00 · até 27% paga R$ 150,00");
  });

  it("sem Alvo padrão, mostra as Faixas em Atingimento", () => {
    const ticket = tipo({ indicador: "ticket-medio", regra: { tipo: "faixas", faixas: [{ atingimento: 80, valorCentavos: 5000 }, { atingimento: 100, valorCentavos: 10000 }] } });
    expect(descreverPremio(ticket)).toBe("Atingimento de 80% paga R$ 50,00 · 100% paga R$ 100,00");
  });

  it("mostra o Fixo de um Indicador em que maior é melhor a partir do Alvo padrão", () => {
    expect(descreverPremio(tipo({ indicador: "ticket-medio", alvoPadrao: 5000 }))).toBe("Ticket Médio a partir de R$ 50,00 paga R$ 100,00");
  });

  it("mostra o Proporcional com Gatilho e Teto", () => {
    const foco = tipo({ indicador: "foco-qtd", alvoPadrao: 200, regra: { tipo: "proporcional", valorCentavos: 10000, gatilho: 80, teto: 120 } });
    expect(descreverPremio(foco)).toBe("Qtd. Total Foco: R$ 100,00 ao chegar a 200, proporcional ao Atingimento · nada abaixo de 160 · no máximo R$ 120,00 a partir de 240");
  });

  it("mostra o Percentual de outro Indicador e se só paga ao atingir", () => {
    const percentual = tipo({ indicador: "foco-qtd", regra: { tipo: "percentual", percentual: 2.5, indicadorBase: "foco-valor", soSeAtingir: true } });
    expect(descreverPremio(percentual)).toBe("Paga 2,5% do Valor Total Foco, se atingir o Alvo");
  });

  it("mostra o Saldo da Meta de Avaliações com o valor inicial", () => {
    expect(descreverPremio(tipo({ indicador: "avaliacoes", regra: { tipo: "saldo" }, alvoPadrao: 20000 }))).toBe(
      "Começa com R$ 200,00, desconta as Avaliações do Período e paga o Saldo",
    );
  });
});

describe("regras do Tipo de Meta", () => {
  it("não aceita o Proporcional em Indicador em que menor é melhor", () => {
    expect(problemaDoTipo(tipo({ regra: { tipo: "proporcional", valorCentavos: 100, gatilho: null, teto: null } }))).toMatch(/menor é melhor/);
  });

  it("sem Alvo só aceita o Percentual que não depende de atingir", () => {
    expect(problemaDoTipo(tipo({ indicador: "foco-valor", semAlvo: true, exibicao: "progresso" }))).toMatch(/sem Alvo/);
    const comissao = tipo({ indicador: "foco-valor", semAlvo: true, exibicao: "progresso", regra: { tipo: "percentual", percentual: 1, indicadorBase: "foco-valor", soSeAtingir: false } });
    expect(problemaDoTipo(comissao)).toBeNull();
    expect(problemaDoTipo({ ...comissao, exibicao: "atingida" })).toMatch(/Atingida/);
  });

  it("a Meta de Avaliações paga o Saldo, e só ela", () => {
    expect(problemaDoTipo(tipo({ indicador: "avaliacoes" }))).toMatch(/Saldo/);
    expect(problemaDoTipo(tipo({ regra: { tipo: "saldo" } }))).toMatch(/Saldo/);
    expect(problemaDoTipo(tipo({ indicador: "avaliacoes", regra: { tipo: "saldo" }, alvoPadrao: 20000 }))).toBeNull();
  });

  it("o Percentual se aplica a um Indicador em R$", () => {
    expect(problemaDoTipo(tipo({ indicador: "foco-qtd", regra: { tipo: "percentual", percentual: 1, indicadorBase: "foco-qtd", soSeAtingir: true } }))).toMatch(/R\$/);
  });

  it("a Contagem é só da Lista de Produtos", () => {
    expect(problemaDoTipo(tipo({ exibicao: "contagem" }))).toMatch(/Contagem/);
    expect(problemaDoTipo(tipo({ indicador: "lista-produtos", exibicao: "contagem" }))).toBeNull();
  });
});
