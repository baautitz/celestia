import { describe, expect, it } from "vitest";
import { sugerirUsername } from "./username-sugerido";

describe("sugerirUsername", () => {
  it.each([
    ["ANTONY MARQUES", "antony_marques"],
    ["JOSÉ DA CONCEIÇÃO SILVA", "jose_conceicao"],
    ["ALAN CRISTIAN MULLER DE OLIVEIRA", "alan_cristian"],
    ["MARIA DAS DORES E SILVA", "maria_dores"],
    ["  camila  ", "camila"],
    ["", ""],
  ])("%s → %s", (nome, esperado) => {
    expect(sugerirUsername(nome)).toBe(esperado);
  });
});
