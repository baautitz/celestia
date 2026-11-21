import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerPedidosLancamentoRoutes } from "./pedidos-lancamento-routes";

const PERMISSAO = "inovafarma:pedidos-lancamento:ver";

function boot({ permissions = [PERMISSAO], falha = false }: { permissions?: string[]; falha?: boolean } = {}) {
  const app = new Hono();
  const auth: MiddlewareHandler = async (c, next) => {
    c.set("user" as never, { sub: "ana", fullname: "Ana", permissions } as never);
    await next();
  };
  const consultas: { sql: string; params?: Record<string, unknown> }[] = [];
  registerPedidosLancamentoRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    erpClient: () => ({
      query: async <T,>(sql: string, params?: Record<string, unknown>) => {
        consultas.push({ sql, params });
        if (falha) throw new Error("boom");
        if (sql.includes("FROM Config")) return [{ codigoEmpresa: 1, nome: "Centro" }, { codigoEmpresa: 2, nome: "Norte" }] as T[];
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
  return { get, consultas };
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
    expect(corpo.ontem).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(corpo.hoje >= corpo.ontem).toBe(true);
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
      { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", vendida: 8, estoque: 10, lojas: [{ codigoLoja: 1, vendida: 5, estoque: 10 }, { codigoLoja: 2, vendida: 3, estoque: 0 }] },
      { produtoId: "p-2", nome: "AAS", codigoBarra: null, vendida: 1, estoque: 4, lojas: [{ codigoLoja: 1, vendida: 1, estoque: 4 }] },
    ]);
    const { sql, params } = consultas[0] ?? { sql: "" };
    expect(params).toMatchObject({ dataInicio: "2027-04-01 00:00:00", dataFim: "2027-04-02 23:59:59", loja0: 1, loja1: 2, grupo: 3 });
    expect(sql).toContain("p.CodigoGrupo = @grupo");
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
