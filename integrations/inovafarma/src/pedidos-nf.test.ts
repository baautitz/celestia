import { describe, expect, it } from "vitest";
import { entradasDosPedidos } from "./pedidos-nf";
import type { ErpQuery } from "./metas-comum";

const pedido = (produtoId: string, criadoEm: string) => ({ criadoEm, itens: [{ produtoId, nome: produtoId, codigoBarra: null, quantidades: [{ codigoLoja: 1, quantidade: 5 }] }], escolhas: { [produtoId]: 7 } });

describe("Entradas de NF dos Pedidos", () => {
  it("numa só consulta, cada Pedido soma só as notas do seu produto desde a sua data", async () => {
    const consultas: string[] = [];
    const client: ErpQuery = {
      query: async <T,>(sql: string) => {
        consultas.push(sql);
        return [
          { produtoId: "a", codigoLoja: 1, dia: "2027-04-01", recebida: 2 },
          { produtoId: "a", codigoLoja: 1, dia: "2027-04-10", recebida: 3 },
          { produtoId: "b", codigoLoja: 1, dia: "2027-04-01", recebida: 9 },
        ] as T[];
      },
    };
    const velho = pedido("a", "2027-04-01T15:00:00Z");
    const novo = pedido("a", "2027-04-05T15:00:00Z");
    const entradas = await entradasDosPedidos(client, [velho, novo]);
    expect(consultas).toHaveLength(1);
    expect(entradas.get(velho)).toEqual(new Map([["a|1", 5]]));
    expect(entradas.get(novo)).toEqual(new Map([["a|1", 3]]));
  });
});
