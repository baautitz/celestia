import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerAvaliacoesRoutes } from "./avaliacoes-routes";
import { MemoryAvaliacaoStore } from "./avaliacoes-store";
import type { PeriodoResumo } from "./pre-vencidos-routes";
import { MemoryVinculoStore } from "./vinculo-store";

const GERAL = "inovafarma:avaliacoes-geral:manage";
const aberto: PeriodoResumo = { id: "abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" };

/** `periods.list` que devolve o Período aberto nas primeiras `abertas` consultas e fechado depois: o fechamento no meio da requisição. */
const fechaDepoisDe = (abertas: number) => {
  let consultas = 0;
  return { list: async () => [++consultas <= abertas ? aberto : { ...aberto, status: "closed" as const }] };
};

async function boot(periods: { list: () => Promise<PeriodoResumo[]> }) {
  const app = new Hono();
  const auth: MiddlewareHandler = async (c, next) => {
    c.set("user" as never, { sub: "gil", fullname: "Gil", permissions: [GERAL] } as never);
    await next();
  };
  const store = new MemoryAvaliacaoStore();
  const avaliacao = await store.criar({ periodoId: "abril", codigoColaborador: 7, nomeColaborador: "ANA", codigoLoja: 1, descricao: "Atraso", valorCentavos: 1250, criadoPor: "gil" });
  registerAvaliacoesRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    erpClient: () => ({ query: async <T,>() => [{ codigoColaborador: 7, nome: "ANA", ativo: true, codigoEmpresa: 1 }] as T[] }),
    store,
    vinculos: new MemoryVinculoStore(),
    users: { list: async () => [] },
    periods,
    audit: { declareAction: () => undefined, record: async () => undefined },
  });
  const request = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { request, store, avaliacao };
}

const FECHADO = { error: "O Período de Fechamento está fechado: não é possível lançar, alterar nem excluir." };

describe("Avaliações: Período no meio da requisição", () => {
  it("responde 404, e não 409 de fechado, à Avaliação cujo Período não existe", async () => {
    const { request, avaliacao } = await boot({ list: async () => [] });
    for (const res of [
      await request("PUT", `/avaliacoes/${avaliacao.id}`, { descricao: "Atraso", valor: 20, version: 1 }),
      await request("DELETE", `/avaliacoes/${avaliacao.id}?version=1`),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Período de Fechamento não encontrado." });
    }
  });

  it("não edita a Avaliação de um Período que fechou depois da conferência", async () => {
    const { request, store, avaliacao } = await boot(fechaDepoisDe(1));
    const res = await request("PUT", `/avaliacoes/${avaliacao.id}`, { descricao: "Outra", valor: 20, version: 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(FECHADO);
    expect(await store.get(avaliacao.id)).toMatchObject({ descricao: "Atraso", valorCentavos: 1250, version: 1 });
  });

  it("não exclui a Avaliação de um Período que fechou depois da conferência", async () => {
    const { request, store, avaliacao } = await boot(fechaDepoisDe(1));
    const res = await request("DELETE", `/avaliacoes/${avaliacao.id}?version=1`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(FECHADO);
    expect(await store.get(avaliacao.id)).toMatchObject({ id: avaliacao.id });
  });

  it("não lança em um Período que fechou depois da conferência", async () => {
    const { request, store } = await boot(fechaDepoisDe(1));
    const res = await request("POST", "/avaliacoes", { periodoId: "abril", codigoColaborador: 7, codigoLoja: 1, descricao: "Nova", valor: 5 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(FECHADO);
    expect((await store.listar({ periodoId: "abril" })).map((a) => a.descricao)).toEqual(["Atraso"]);
  });
});
