import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { MemoryCotacaoStore } from "./cotacao-store";
import { declareLimitesAudit } from "./pedidos-limites-audit";
import { consumoDoLimite } from "./pedidos-limites-consumo";
import { registerPedidosLimitesRoutes } from "./pedidos-limites-routes";
import { MemoryLimitesStore } from "./pedidos-limites-store";
import { MemoryPedidoStore } from "./pedidos-store";
import type { ErpQuery } from "./metas-comum";
import type { Pedido } from "./pedidos";
import type { AuditService } from "./vinculo-audit";

const VER = "inovafarma:pedidos-limites:ver";
const GERIR = "inovafarma:pedidos-limites:gerir";
const regra = { nome: "Genéricos", entradas: [{ tipo: "grupo" as const, id: "3", nome: "Genéricos" }], fornecedores: [] as number[] };
const todas = { tipo: "todas" as const, valorCentavos: 1_000_000 };
const novembro = (regraId: string) => ({ regraId, inicio: "2026-11-01", fim: "2026-11-30", distribuicao: todas });

interface Erp {
  entradas?: { codigoLoja: number; valor: number }[];
  vendas?: { codigoLoja: number; valor: number }[];
  transferencias?: { codigoLoja: number; valor: number }[];
}

const erp = ({ entradas = [], vendas = [], transferencias = [] }: Erp, consultas: string[] = []): ErpQuery => ({
  query: async <T,>(sql: string) => {
    consultas.push(sql);
    if (sql.includes("FROM Venda v")) return vendas as T[];
    if (sql.includes("cp.Quantidade * cp.Preco")) return entradas as T[];
    if (sql.includes("FROM Estoque_Movimentacao m")) return transferencias as T[];
    if (sql.includes("FROM Produto p WHERE")) return [{ produtoId: "p-1" }] as T[];
    return [] as T[];
  },
});

/** Pedido confirmado com o fornecedor 7 a R$ 10,00: 5 unidades na Loja 1 e 2 na Loja 2 de um produto da lista. */
async function pedidoConfirmado() {
  const pedidos = new MemoryPedidoStore();
  const cotacoes = new MemoryCotacaoStore();
  const item = (produtoId: string) => ({ produtoId, nome: produtoId, codigoBarra: null, quantidades: [{ codigoLoja: 1, quantidade: 5 }, { codigoLoja: 2, quantidade: 2 }] });
  const criado = await pedidos.criar({ itens: [item("p-1"), item("p-fora")] }, { id: "gil", nome: "gil" });
  await pedidos.iniciarCotacao(criado.id, 1);
  await cotacoes.criar(criado.id, [7]);
  await cotacoes.gravarPrecos(criado.id, 7, { "p-1": 10, "p-fora": 99 }, {}, 1);
  const cotado = (await pedidos.marcarCotado(criado.id)) as Pedido;
  await pedidos.confirmar(criado.id, { "p-1": 7, "p-fora": 7 }, cotado.version);
  return { pedidos, cotacoes };
}

describe("consumo do Limite de Compras", () => {
  const consumo = async (erpDados: Erp, distribuicao: Parameters<typeof consumoDoLimite>[2]["distribuicao"] = todas, extras: { fornecedores?: number[]; hoje?: string } = {}) => {
    const { pedidos, cotacoes } = await pedidoConfirmado();
    return consumoDoLimite(
      { client: erp(erpDados), pedidos, cotacoes, hoje: extras.hoje ?? "2026-11-15" },
      { ...regra, fornecedores: extras.fornecedores ?? [], id: "r", version: 1 },
      { ...novembro("r"), distribuicao, id: "v", version: 1 },
    );
  };

  it("desconta entradas e comprometido e devolve o custo vendido, somando as Lojas", async () => {
    expect(await consumo({ entradas: [{ codigoLoja: 1, valor: 8000 }], vendas: [{ codigoLoja: 2, valor: 3000 }] })).toEqual([
      { codigoLoja: null, valorCentavos: 1_000_000, entradasCentavos: 800_000, comprometidoCentavos: 7_000, repostoCentavos: 300_000, saldoCentavos: 493_000 },
    ]);
  });

  it("separa o saldo por Loja, nunca passa do valor e fica negativo no estouro", async () => {
    const saldos = await consumo(
      { entradas: [{ codigoLoja: 2, valor: 20 }], vendas: [{ codigoLoja: 1, valor: 500 }] },
      { tipo: "porLoja", lojas: [{ codigoLoja: 1, valorCentavos: 10_000 }, { codigoLoja: 2, valorCentavos: 1_000 }] },
    );
    expect(saldos.map((s) => [s.codigoLoja, s.comprometidoCentavos, s.saldoCentavos])).toEqual([[1, 5_000, 10_000], [2, 2_000, -3_000]]);
  });

  it("conta a transferência recebida na entrada e desconta a enviada", async () => {
    const saldos = await consumo(
      { entradas: [{ codigoLoja: 1, valor: 10_000 }], transferencias: [{ codigoLoja: 1, valor: -4_000 }, { codigoLoja: 2, valor: 4_000 }] },
      { tipo: "porLoja", lojas: [{ codigoLoja: 1, valorCentavos: 1_000_000 }, { codigoLoja: 2, valorCentavos: 1_000_000 }] },
    );
    expect(saldos.map((s) => s.entradasCentavos)).toEqual([600_000, 400_000]);
  });

  it("ignora o comprometido de outra distribuidora e fora da vigência em curso", async () => {
    expect((await consumo({}, todas, { fornecedores: [9] }))[0]?.comprometidoCentavos).toBe(0);
    expect((await consumo({}, todas, { hoje: "2026-12-01" }))[0]?.comprometidoCentavos).toBe(0);
  });
});

function boot() {
  const app = new Hono();
  const log: string[] = [];
  const resumos = new Map<string, (a: never) => string>();
  const audit: AuditService = {
    declareAction: (def) => void resumos.set(def.action, def.summary as (a: never) => string),
    record: async (input) => void log.push(resumos.get(input.action)?.(input.attributes as never) ?? "?"),
  };
  declareLimitesAudit(audit);
  const auth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("x-user") ?? "";
    c.set("user" as never, { sub, fullname: sub, permissions: sub === "gil" ? [VER, GERIR] : sub === "bia" ? [VER] : [] } as never);
    await next();
  };
  registerPedidosLimitesRoutes({ routes: app, permissions: { has: (p, k) => Boolean(p?.includes(k)) }, auth, audit, limites: new MemoryLimitesStore(), pedidos: new MemoryPedidoStore(), cotacoes: new MemoryCotacaoStore(), erpClient: () => erp({}) });
  return {
    log,
    req: (who: string, method: string, path: string, body?: unknown) =>
      app.request(path, { method, headers: { "x-user": who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
  };
}

describe("rotas do Limite de Compras", () => {
  it("cadastra Regra e Valor com Audit Log, recusa conflito e protege a Regra com Valores", async () => {
    const { req, log } = boot();
    const criada = (await (await req("gil", "POST", "/pedidos/limites/regras", regra)).json()) as { id: string };
    expect((await req("gil", "POST", "/pedidos/limites/regras", regra)).status).toBe(409);
    const lancado = await req("gil", "POST", "/pedidos/limites/valores", novembro(criada.id));
    expect(lancado.status).toBe(201);
    const { id } = (await lancado.json()) as { id: string };
    expect((await req("gil", "PUT", `/pedidos/limites/valores/${id}`, { ...novembro(criada.id), version: 9 })).status).toBe(409);
    expect((await req("gil", "DELETE", `/pedidos/limites/regras/${criada.id}?version=1`)).status).toBe(409);
    expect((await req("bia", "GET", `/pedidos/limites/valores/${id}/consumo`)).status).toBe(200);
    expect((await req("gil", "DELETE", `/pedidos/limites/valores/${id}?version=1`)).status).toBe(204);
    expect((await req("gil", "DELETE", `/pedidos/limites/regras/${criada.id}?version=1`)).status).toBe(204);
    expect(log[1]).toBe('Lançou o Valor do Limite da Regra "Genéricos", de 01/11/2026 a 30/11/2026: R$ 10.000,00 para todas as Lojas.');
    expect(log).toHaveLength(4);
  });

  it("exige as Permissions", async () => {
    const { req } = boot();
    expect((await req("ana", "GET", "/pedidos/limites")).status).toBe(403);
    expect((await req("bia", "GET", "/pedidos/limites")).status).toBe(200);
    expect((await req("bia", "POST", "/pedidos/limites/regras", regra)).status).toBe(403);
  });
});
