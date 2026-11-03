import { describe, expect, it } from "vitest";
import { rankBySearch, searchScore } from "./fuzzy-search";

describe("searchScore", () => {
  it("sem consulta, tudo casa", () => {
    expect(searchScore("  ", ["qualquer"])).toBe(0);
  });

  it("exige que cada palavra case, em qualquer ordem e campo", () => {
    expect(searchScore("caixa entrou", ["Entrou pelo Dispositivo Caixa"])).not.toBeNull();
    expect(searchScore("ana caixa", ["Ana", "Caixa 1"])).not.toBeNull();
    expect(searchScore("ana bruno", ["Ana"])).toBeNull();
  });

  it("ignora maiúsculas e acentos dos dois lados", () => {
    expect(searchScore("usuario", ["Criou o Usuário"])).not.toBeNull();
    expect(searchScore("USUÁRIO", ["criou o usuario"])).not.toBeNull();
  });

  it("aceita um erro de digitação em palavras de 4 letras ou mais", () => {
    expect(searchScore("dispositvo", ["Entrou pelo Dispositivo"])).not.toBeNull();
    expect(searchScore("dispisitivo", ["Entrou pelo Dispositivo"])).not.toBeNull();
    expect(searchScore("anx", ["Ana"])).toBeNull();
    expect(searchScore("dspstivo", ["Dispositivo"])).toBeNull();
  });

  it("aceita um erro de digitação no começo de uma palavra ainda incompleta", () => {
    expect(searchScore("dispoz", ["Dispositivo"])).not.toBeNull();
  });

  it("pontua palavra inteira > começo de palavra > meio do texto > com erro", () => {
    const whole = searchScore("caixa", ["Caixa 1"])!;
    const prefix = searchScore("caix", ["Caixas"])!;
    const middle = searchScore("aixa", ["Caixa"])!;
    const typo = searchScore("caiza", ["Caixa"])!;
    expect(whole).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(typo);
  });

  it("casa ids com pontuação pelo texto inteiro", () => {
    expect(searchScore("cp-1", ["closing_period cp-1"])).not.toBeNull();
    expect(searchScore("7f6b", ["24075a7c-76b5-4937-a927-72ab41b7f6bb"])).not.toBeNull();
  });
});

describe("rankBySearch", () => {
  const rows = [
    { id: 1, text: "Caixas da Loja" },
    { id: 2, text: "Fechou o período" },
    { id: 3, text: "Caixa 1" },
    { id: 4, text: "Outro caixa" },
  ];

  it("filtra e ordena pela relevância, mantendo a ordem original no empate", () => {
    expect(rankBySearch(rows, "caixa", (r) => [r.text]).map((r) => r.id)).toEqual([3, 4, 1]);
  });

  it("sem consulta, devolve as linhas como vieram", () => {
    expect(rankBySearch(rows, "", (r) => [r.text])).toBe(rows);
  });
});
