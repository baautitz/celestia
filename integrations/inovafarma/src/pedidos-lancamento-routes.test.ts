import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerPedidosLancamentoRoutes } from "./pedidos-lancamento-routes";
import { MemoryPedidoStore } from "./pedidos-store";
import { MemoryPedidosListasStore } from "./pedidos-listas-store";
import { MemoryMinimoMaximoStore } from "./pedidos-minimos-store";
import { declarePedidosMinimosAudit } from "./pedidos-minimos-audit";
import type { AuditService } from "./vinculo-audit";

const PERMISSAO = "inovafarma:pedidos-lancamento:ver";
const EDITAR = "inovafarma:pedidos-minimos:editar";

function boot({ permissions = [PERMISSAO, EDITAR], falha = false }: { permissions?: string[]; falha?: boolean } = {}) {
  const app = new Hono();
  const auth: MiddlewareHandler = async (c, next) => {
    c.set("user" as never, { sub: "ana", fullname: "Ana", permissions } as never);
    await next();
  };
  const listas = new MemoryPedidosListasStore();
  const pedidos = new MemoryPedidoStore();
  const store = new MemoryMinimoMaximoStore();
  const resumos = new Map<string, (a: never) => string>();
  const log: string[] = [];
  const audit: AuditService = {
    declareAction: (def) => void resumos.set(def.action, def.summary as (a: never) => string),
    record: async (input) => void log.push(resumos.get(input.action)?.(input.attributes as never) ?? "?"),
  };
  declarePedidosMinimosAudit(audit);
  const consultas: { sql: string; params?: Record<string, unknown> }[] = [];
  registerPedidosLancamentoRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    listas,
    pedidos,
    minimos: store,
    audit,
    erpClient: () => ({
      query: async <T,>(sql: string, params?: Record<string, unknown>) => {
        consultas.push({ sql, params });
        if (falha) throw new Error("boom");
        if (sql.includes("FROM Config")) return [{ codigoEmpresa: 1, nome: "Centro" }, { codigoEmpresa: 2, nome: "Norte" }] as T[];
        if (sql.includes("c.DataNota")) return [{ produtoId: "p-1", codigoLoja: 1, recebida: 6, dia: "2999-01-01" }] as T[];
        if (sql.includes("Produto_Fabricante")) return [{ id: 7, nome: "EMS" }] as T[];
        if (sql.includes("Produto_Grupo")) return [{ id: 3, nome: "MEDICAMENTOS" }] as T[];
        if (sql.includes("Produto_Sessao")) return [{ id: 9, nome: "GENERICOS" }] as T[];
        if (sql.includes("estoque"))
          return [
            { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", codigoLoja: 1, vendida: 5, estoque: 10 },
            { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", codigoLoja: 2, vendida: 3, estoque: null },
            { produtoId: "p-2", nome: "AAS", codigoBarra: null, codigoLoja: 1, vendida: 1, estoque: 4 },
          ] as T[];
        return [
          { mes: "2027-03", vendida: 12, comprada: null },
          { mes: "2027-04", vendida: null, comprada: 30 },
        ] as T[];
      },
    }),
  });
  const get = (path: string) => app.request(path);
  const put = (corpo: unknown) => app.request("/pedidos/lancamento/minimos", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  return { get, put, consultas, log, listas, pedidos };
}

describe("Lançamento de Pedidos: contexto", () => {
  it("devolve as Lojas e as opções de filtro, mais ontem e hoje", async () => {
    const res = await boot().get("/pedidos/lancamento/contexto");
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as Record<string, unknown>;
    expect(corpo.lojas).toEqual([{ codigo: 1, nome: "Centro" }, { codigo: 2, nome: "Norte" }]);
    expect(corpo.laboratorios).toEqual([{ id: "7", nome: "EMS" }]);
    expect(corpo.grupos).toEqual([{ id: "3", nome: "MEDICAMENTOS" }]);
    expect(corpo.secoes).toEqual([{ id: "9", nome: "GENERICOS" }]);
    expect(corpo.podeEditarMinimos).toBe(true);
    expect(corpo.ontem).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(corpo.hoje >= corpo.ontem).toBe(true);
  });

  it("oferece só as listas prontas (com entradas), por nome", async () => {
    const { get, listas } = boot();
    const pronta = await listas.criar({ nome: "Vitaminas", entradas: [{ tipo: "grupo", id: "44", nome: "VITAMINAS" }] });
    await listas.criar({ nome: "Em montagem", entradas: [] });
    const corpo = (await (await get("/pedidos/lancamento/contexto")).json()) as { listas: unknown };
    expect(corpo.listas).toEqual([{ id: pronta.id, nome: "Vitaminas" }]);
  });

  it("recusa quem não tem a Permission", async () => {
    const res = await boot({ permissions: [] }).get("/pedidos/lancamento/contexto");
    expect(res.status).toBe(403);
  });
});

describe("Lançamento de Pedidos: produtos", () => {
  it("agrupa por produto, com as linhas por Loja e o total vendido", async () => {
    const { get, consultas } = boot();
    const res = await get("/pedidos/lancamento/produtos?modo=periodo&de=2027-04-01&ate=2027-04-02&lojas=1,2&grupo=3");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", vendida: 8, estoque: 10, minimo: 0, sugestao: 3, aChegar: 0, lojas: [{ codigoLoja: 1, vendida: 5, estoque: 10, minimo: null, maximo: null, sugestao: 0, aChegar: 0, version: 0 }, { codigoLoja: 2, vendida: 3, estoque: 0, minimo: null, maximo: null, sugestao: 3, aChegar: 0, version: 0 }] },
      { produtoId: "p-2", nome: "AAS", codigoBarra: null, vendida: 1, estoque: 4, minimo: 0, sugestao: 0, aChegar: 0, lojas: [{ codigoLoja: 1, vendida: 1, estoque: 4, minimo: null, maximo: null, sugestao: 0, aChegar: 0, version: 0 }] },
    ]);
    const { sql, params } = consultas[0] ?? { sql: "" };
    expect(params).toMatchObject({ dataInicio: "2027-04-01 00:00:00", dataFim: "2027-04-02 23:59:59", loja0: 1, loja1: 2, grupo: 3 });
    expect(sql).toContain("p.CodigoGrupo = @grupo");
  });

  it("filtra por várias listas prontas, unidas por OR, com os ids por parâmetro", async () => {
    const { get, consultas, listas } = boot();
    const a = await listas.criar({ nome: "A", entradas: [{ tipo: "grupo", id: "44", nome: "VITAMINAS" }] });
    const b = await listas.criar({ nome: "B", entradas: [{ tipo: "laboratorio", id: "7", nome: "EMS" }, { tipo: "grupo", id: "45", nome: "X" }] });
    const vazia = await listas.criar({ nome: "Vazia", entradas: [] });
    const res = await get(`/pedidos/lancamento/produtos?modo=apartir&de=2027-04-01&listas=${a.id},${b.id},${vazia.id}`);
    expect(res.status).toBe(200);
    const { sql, params } = consultas[0] ?? { sql: "" };
    expect(sql).toContain("p.CodigoGrupo IN (@listagrupo0, @listagrupo1)");
    expect(sql).toContain("p.CodigoFabricante IN (@listalaboratorio0)");
    expect(params).toMatchObject({ listagrupo0: 44, listagrupo1: 45, listalaboratorio0: 7 });
  });

  it("com listas escolhidas mas nenhuma pronta, não traz produto algum", async () => {
    const { get, consultas } = boot();
    const res = await get("/pedidos/lancamento/produtos?modo=apartir&de=2027-04-01&listas=plp_sumiu");
    expect(await res.json()).toEqual([]);
    expect(consultas.length).toBe(0);
  });

  it("no modo a partir de, vai até hoje", async () => {
    const { get, consultas } = boot();
    await get("/pedidos/lancamento/produtos?modo=apartir&de=2027-04-01");
    expect(String(consultas[0]?.params?.dataFim)).toMatch(/^\d{4}-\d{2}-\d{2} 23:59:59$/);
  });

  it("recusa datas inválidas, período invertido e lojas fora do formato", async () => {
    const { get } = boot();
    expect((await get("/pedidos/lancamento/produtos?modo=periodo&de=2027-13-01&ate=2027-04-02")).status).toBe(400);
    expect((await get("/pedidos/lancamento/produtos?modo=periodo&de=2027-04-05&ate=2027-04-02")).status).toBe(400);
    expect((await get("/pedidos/lancamento/produtos?modo=apartir&de=2027-04-01&lojas=1;DROP")).status).toBe(400);
  });

  it("responde 503 quando o ERP falha", async () => {
    const res = await boot({ falha: true }).get("/pedidos/lancamento/produtos?modo=apartir&de=2027-04-01");
    expect(res.status).toBe(503);
  });
});

describe("Lançamento de Pedidos: movimentação mensal", () => {
  it("junta venda e compra por mês do produto", async () => {
    const res = await boot().get("/pedidos/lancamento/movimentacao?produtoId=p-1&lojas=1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { mes: "2027-03", vendida: 12, comprada: 0 },
      { mes: "2027-04", vendida: 0, comprada: 30 },
    ]);
  });

  it("exige o produto", async () => {
    expect((await boot().get("/pedidos/lancamento/movimentacao")).status).toBe(400);
  });
});

describe("Lançamento de Pedidos: estoque mínimo e máximo", () => {
  const PRODUTOS = "/pedidos/lancamento/produtos?modo=apartir&de=2027-04-01";

  it("grava o mínimo e o máximo da Loja, com version, e registra no Audit Log", async () => {
    const { put, log } = boot();
    const res = await put({ produtoId: "p-1", codigoLoja: 1, minimo: 20, maximo: 50, version: 0 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ produtoId: "p-1", codigoLoja: 1, minimo: 20, maximo: 50, version: 1 });
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("20");
  });

  it("reflete na grade e na sugestão: vendas + mínimo - estoque, nunca negativa", async () => {
    const { get, put } = boot();
    await put({ produtoId: "p-1", codigoLoja: 1, minimo: 20, maximo: null, version: 0 });
    const produtos = (await (await get(PRODUTOS)).json()) as { produtoId: string; minimo: number; sugestao: number; lojas: { codigoLoja: number; minimo: number | null; sugestao: number; version: number }[] }[];
    const dipirona = produtos.find((p) => p.produtoId === "p-1");
    expect(dipirona?.lojas[0]).toMatchObject({ minimo: 20, sugestao: 15, version: 1 });
    expect(dipirona?.lojas[1]).toMatchObject({ minimo: null, sugestao: 3 });
    expect(dipirona).toMatchObject({ minimo: 20, sugestao: 18 });
  });

  it("filtra apenas os produtos com estoque mínimo", async () => {
    const { get, put } = boot();
    await put({ produtoId: "p-2", codigoLoja: 1, minimo: 5, maximo: null, version: 0 });
    const produtos = (await (await get(`${PRODUTOS}&apenasMinimo=1`)).json()) as { produtoId: string }[];
    expect(produtos.map((p) => p.produtoId)).toEqual(["p-2"]);
  });

  it("recusa com 409 uma edição sobre version desatualizada", async () => {
    const { put } = boot();
    await put({ produtoId: "p-1", codigoLoja: 1, minimo: 1, maximo: null, version: 0 });
    const res = await put({ produtoId: "p-1", codigoLoja: 1, minimo: 2, maximo: null, version: 0 });
    expect(res.status).toBe(409);
  });

  it("recusa máximo menor que o mínimo e valores negativos", async () => {
    const { put } = boot();
    expect((await put({ produtoId: "p-1", codigoLoja: 1, minimo: 10, maximo: 5, version: 0 })).status).toBe(400);
    expect((await put({ produtoId: "p-1", codigoLoja: 1, minimo: -1, maximo: null, version: 0 })).status).toBe(400);
  });

  it("exige a Permission de editar", async () => {
    const res = await boot({ permissions: [PERMISSAO] }).put({ produtoId: "p-1", codigoLoja: 1, minimo: 1, maximo: null, version: 0 });
    expect(res.status).toBe(403);
  });
});

describe("Lançamento de Pedidos: a chegar", () => {
  const item = (produtoId: string, quantidades: { codigoLoja: number; quantidade: number }[]) => ({ produtoId, nome: produtoId, codigoBarra: null, quantidades });
  const consulta = "/pedidos/lancamento/produtos?modo=periodo&de=2027-04-01&ate=2027-04-30";

  it("mostra o pedido aberto menos as entradas de NF, por Loja e por produto", async () => {
    const { get, pedidos } = boot();
    const p = await pedidos.criar({ itens: [item("p-1", [{ codigoLoja: 1, quantidade: 10 }, { codigoLoja: 2, quantidade: 4 }])] }, { id: "u", nome: "U" });
    await pedidos.iniciarCotacao(p.id, 1);
    await pedidos.marcarCotado(p.id);
    await pedidos.confirmar(p.id, { "p-1": 7 }, 3);
    const produtos = (await (await get(consulta)).json()) as { produtoId: string; aChegar: number; lojas: { codigoLoja: number; aChegar: number }[] }[];
    const dipirona = produtos.find((x) => x.produtoId === "p-1");
    expect(dipirona?.lojas.map((l) => l.aChegar)).toEqual([4, 4]);
    expect(dipirona?.aChegar).toBe(8);
    expect(produtos.find((x) => x.produtoId === "p-2")?.aChegar).toBe(0);
  });

  it("consulta as entradas de NF uma única vez, mesmo com vários Pedidos abertos", async () => {
    const { get, pedidos, consultas } = boot();
    for (const loja of [1, 2]) {
      const p = await pedidos.criar({ itens: [item("p-1", [{ codigoLoja: loja, quantidade: 10 }])] }, { id: "u", nome: "U" });
      await pedidos.iniciarCotacao(p.id, 1);
      await pedidos.marcarCotado(p.id);
      await pedidos.confirmar(p.id, { "p-1": 7 }, 3);
    }
    await get(consulta);
    expect(consultas.filter((q) => q.sql.includes("@desde"))).toHaveLength(1);
  });

  it("não conta Pedido que ainda não foi confirmado nem o já recebido por inteiro", async () => {
    const { get, pedidos } = boot();
    await pedidos.criar({ itens: [item("p-1", [{ codigoLoja: 1, quantidade: 10 }])] }, { id: "u", nome: "U" });
    const feito = await pedidos.criar({ itens: [item("p-1", [{ codigoLoja: 1, quantidade: 6 }])] }, { id: "u", nome: "U" });
    await pedidos.iniciarCotacao(feito.id, 1);
    await pedidos.marcarCotado(feito.id);
    await pedidos.confirmar(feito.id, { "p-1": 7 }, 3);
    const produtos = (await (await get(consulta)).json()) as { produtoId: string; aChegar: number }[];
    expect(produtos.find((x) => x.produtoId === "p-1")?.aChegar).toBe(0);
  });
});
