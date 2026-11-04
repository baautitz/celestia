import { describe, expect, it } from "vitest";
import { abbreviateName } from "./abbreviate-name";

describe("abbreviateName", () => {
  it("mantém o nome que cabe", () => {
    expect(abbreviateName("Ana Paula Porto", 24)).toBe("Ana Paula Porto");
  });

  it("abrevia os do meio, do último para o primeiro, só até caber", () => {
    expect(abbreviateName("ALAN CRISTIAN MULLER DE OLIVEIRA", 28)).toBe("ALAN CRISTIAN M. DE OLIVEIRA");
    expect(abbreviateName("ALAN CRISTIAN MULLER DE OLIVEIRA", 20)).toBe("ALAN C. M. DE OLIVEIRA");
  });

  it("tira a partícula do meio junto com o sobrenome abreviado", () => {
    expect(abbreviateName("Maria das Graças Souza Lima", 10)).toBe("Maria G. S. Lima");
  });

  it("nunca abrevia o primeiro nome nem o último sobrenome", () => {
    expect(abbreviateName("Aleksandra Suptitz", 5)).toBe("Aleksandra Suptitz");
  });
});
