import { describe, expect, it } from "vitest";
import { NomeDuplicadoError } from "./erros-de-store.js";
import { DadosRegraLimite, DadosValorLimite } from "./pedidos-limites.js";
import { MemoryLimitesStore, RegraComValoresError, RegraInexistenteError } from "./pedidos-limites-store.js";

const regra: DadosRegraLimite = { nome: "Genéricos", entradas: [{ tipo: "grupo", id: "3", nome: "Genéricos" }], fornecedores: [] };
const valor = (regraId: string): DadosValorLimite => ({ regraId, inicio: "2026-11-01", fim: "2026-11-30", distribuicao: { tipo: "todas", valorCentavos: 1_000_000 } });

describe("Limite de Compras", () => {
  it("recusa vigência invertida, Loja repetida e identificador inválido", () => {
    expect(DadosValorLimite.safeParse({ ...valor("r"), fim: "2026-10-31" }).success).toBe(false);
    const loja = { codigoLoja: 1, valorCentavos: 100 };
    expect(DadosValorLimite.safeParse({ ...valor("r"), distribuicao: { tipo: "porLoja", lojas: [loja, loja] } }).success).toBe(false);
    expect(DadosRegraLimite.safeParse({ ...regra, entradas: [{ tipo: "produto", id: "3", nome: "x" }] }).success).toBe(false);
  });

  it("guarda Regras e Valores com version e protege a Regra que tem Valores", async () => {
    const store = new MemoryLimitesStore();
    const criada = await store.criarRegra(regra);
    await expect(store.criarRegra({ ...regra, nome: "GENÉRICOS" })).rejects.toThrow(NomeDuplicadoError);
    await expect(store.criarValor(valor("outra"))).rejects.toThrow(RegraInexistenteError);
    const lancado = await store.criarValor(valor(criada.id));
    expect(await store.atualizarValor(lancado.id, valor(criada.id), 2)).toBeNull();
    await expect(store.removerRegra(criada.id, 1)).rejects.toThrow(RegraComValoresError);
    expect(await store.removerValor(lancado.id, 1)).toBe(true);
    expect(await store.removerRegra(criada.id, 1)).toBe(true);
  });
});
