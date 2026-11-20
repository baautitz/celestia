import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerFuroEstoqueRoutes } from "./furo-estoque-routes";
import { MemoryFuroEstoqueStore } from "./furo-estoque-store";
import type { PeriodoResumo } from "./pre-vencidos-routes";
import { MemoryVinculoStore } from "./vinculo-store";

const GERAL = "inovafarma:furo-estoque-geral:manage";
const aberto: PeriodoResumo = { id: "abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" };
const AJUSTE = {
  codigoMovimento: 100,
  codigoLoja: 1,
  data: "2027-04-10T15:36:00Z",
  operacao: "-",
  produtoId: "p-1",
  nome: "DIPIRONA",
  codigoBarra: null,
  quantidade: -2,
  precoCusto: 5,
  totalCusto: -10,
  colaborador: null,
  usuario: null,
  observacao: null,
};

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
  const store = new MemoryFuroEstoqueStore(["Vencido", "Troca"]);
  const [vencido] = await store.listarMotivos();
  if (!vencido) throw new Error("Motivo inicial ausente.");
  const justificativa = await store.justificar({ periodoId: "abril", codigoMovimento: 100, codigoLoja: 1, motivoId: vencido.id, observacao: null, criadoPor: "gil" });
  if (!justificativa) throw new Error("Justificativa inicial ausente.");
  registerFuroEstoqueRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    erpClient: () => ({ query: async <T,>(sql: string) => (sql.includes("Estoque_Movimentacao") ? [AJUSTE] : []) as T[] }),
    store,
    vinculos: new MemoryVinculoStore(),
    users: { list: async () => [] },
    periods,
    audit: { declareAction: () => undefined, record: async () => undefined },
  });
  const request = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { request, store, justificativa, vencido };
}

const FECHADO = { error: "O Período de Fechamento está fechado: não é possível justificar, alterar nem excluir." };

describe("Furo de Estoque: Período no meio da requisição", () => {
  it("responde 404, e não 409 de fechado, à Justificativa cujo Período não existe", async () => {
    const { request, justificativa, vencido } = await boot({ list: async () => [] });
    for (const res of [
      await request("PUT", `/furo-estoque/justificativas/${justificativa.id}`, { motivoId: vencido.id, observacao: null, version: 1 }),
      await request("DELETE", `/furo-estoque/justificativas/${justificativa.id}?version=1`),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Período de Fechamento não encontrado." });
    }
  });

  it("não edita a Justificativa de um Período que fechou depois da conferência", async () => {
    const { request, store, justificativa, vencido } = await boot(fechaDepoisDe(1));
    const res = await request("PUT", `/furo-estoque/justificativas/${justificativa.id}`, { motivoId: vencido.id, observacao: "nova", version: 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(FECHADO);
    expect(await store.justificativa(justificativa.id)).toMatchObject({ observacao: null, version: 1 });
  });

  it("não exclui a Justificativa de um Período que fechou depois da conferência", async () => {
    const { request, store, justificativa } = await boot(fechaDepoisDe(1));
    const res = await request("DELETE", `/furo-estoque/justificativas/${justificativa.id}?version=1`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(FECHADO);
    expect(await store.justificativa(justificativa.id)).toMatchObject({ id: justificativa.id });
  });

  it("não justifica o Ajuste de um Período que fechou durante a consulta ao ERP", async () => {
    const { request, store, vencido } = await boot(fechaDepoisDe(1));
    // O Ajuste 100 já tem Justificativa; apaga para provar que a recusa é do Período, não do Ajuste repetido.
    const [existente] = await store.listarJustificativas("abril");
    if (existente) await store.excluirJustificativa(existente.id, existente.version);
    const res = await request("POST", "/furo-estoque/justificativas", { periodoId: "abril", codigoMovimento: 100, motivoId: vencido.id });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(FECHADO);
    expect(await store.listarJustificativas("abril")).toEqual([]);
  });
});

describe("Furo de Estoque: validação e nomes de Motivo", () => {
  const aberta = { list: async () => [aberto] };

  it("recusa com o corpo de validação da plataforma o campo inválido, o filtro que não é código e a version fora do padrão", async () => {
    const { request, justificativa } = await boot(aberta);
    const semMotivo = await request("POST", "/furo-estoque/justificativas", { periodoId: "abril", codigoMovimento: 100, motivoId: "" });
    expect(semMotivo.status).toBe(400);
    expect(await semMotivo.json()).toEqual({ error: { issues: [{ path: ["motivoId"], message: "Selecione um Motivo ativo." }] } });
    const loja = await request("GET", "/furo-estoque/ajustes?periodoId=abril&codigoLoja=abc");
    expect(loja.status).toBe(400);
    expect(await loja.json()).toEqual({ error: { issues: [{ path: ["codigoLoja"], message: "Informe um código inteiro maior que zero." }] } });
    for (const version of ["", "0", "x"]) {
      const res = await request("DELETE", `/furo-estoque/justificativas/${justificativa.id}?version=${version}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { issues: [{ path: ["version"], message: "Parâmetro 'version' é obrigatório." }] } });
    }
  });

  it("responde 409 com a mensagem ao nome de Motivo repetido, ao criar e ao renomear, sem diferenciar maiúsculas", async () => {
    const { request, store } = await boot(aberta);
    const repetido = { error: "Já existe um Motivo com este nome." };
    const criar = await request("POST", "/furo-estoque/motivos", { nome: "VENCIDO" });
    expect(criar.status).toBe(409);
    expect(await criar.json()).toEqual(repetido);
    const troca = (await store.listarMotivos()).find((m) => m.nome === "Troca");
    const renomear = await request("PUT", `/furo-estoque/motivos/${troca?.id}`, { nome: "vencido", ativo: true, version: 1 });
    expect(renomear.status).toBe(409);
    expect(await renomear.json()).toEqual(repetido);
    // O próprio nome, com outra caixa, é uma alteração válida.
    expect((await request("PUT", `/furo-estoque/motivos/${troca?.id}`, { nome: "TROCA", ativo: true, version: 1 })).status).toBe(200);
    expect((await request("POST", "/furo-estoque/motivos", { nome: "Avaria" })).status).toBe(201);
  });
});
