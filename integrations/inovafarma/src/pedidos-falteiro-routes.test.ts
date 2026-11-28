import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { declareFalteiroAudit } from "./pedidos-falteiro-audit.js";
import { registerPedidosFalteiroRoutes } from "./pedidos-falteiro-routes.js";
import { MemoryFalteiroStore } from "./pedidos-falteiro-store.js";
import { MemoryVinculoStore } from "./vinculo-store.js";
import type { AuditService } from "./vinculo-audit.js";
import { defined } from "./test/defined.js";

const GERIR = "inovafarma:pedidos-falteiro:gerir";
const TODAS = "inovafarma:pedidos-todas-lojas:gerir";

interface ErpMock {
  estoques?: { produtoId: string; codigoLoja: number; estoque: number | null }[];
  produtos?: { produtoId: string; nome: string | null; codigoBarra: string | null }[];
  entradas?: { produtoId: string; codigoLoja: number; ultimaEntrada: string | null }[];
  falha?: boolean;
}

function boot({
  permissions = [GERIR, TODAS],
  lojasVinculo = [1],
  erp = {},
}: {
  permissions?: string[];
  lojasVinculo?: number[] | null;
  erp?: ErpMock;
} = {}) {
  const app = new Hono();
  const store = new MemoryFalteiroStore();
  const vinculos = new MemoryVinculoStore();
  if (lojasVinculo !== null) {
    void vinculos.gravar({ codigoColaborador: 10, usuarioId: "ana", lojas: lojasVinculo, atualizadoPor: "admin" }, 0);
  }
  const resumos = new Map<string, (a: never) => string>();
  const log: string[] = [];
  const audit: AuditService = {
    declareAction: (def) => void resumos.set(def.action, def.summary as (a: never) => string),
    record: async (input) => void log.push(defined(resumos.get(input.action), "audit summary")(input.attributes as never)),
  };
  declareFalteiroAudit(audit);

  const auth: MiddlewareHandler = async (c, next) => {
    c.set("user" as never, { sub: "ana", fullname: "Ana", permissions } as never);
    await next();
  };

  const produtosPadrao = erp.produtos ?? [
    { produtoId: "p-1", nome: "DIPIRONA 500MG", codigoBarra: "7891" },
    { produtoId: "p-2", nome: "AAS 100MG", codigoBarra: null },
  ];
  const estoquesPadrao = erp.estoques ?? [
    { produtoId: "p-1", codigoLoja: 1, estoque: 5 },
    { produtoId: "p-1", codigoLoja: 2, estoque: 3 },
    { produtoId: "p-2", codigoLoja: 1, estoque: 0 },
  ];
  const entradasPadrao = erp.entradas ?? [];

  registerPedidosFalteiroRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    falteiro: store,
    vinculos,
    audit,
    erpClient: () => ({
      query: async <T,>(sql: string) => {
        if (erp.falha) throw new Error("boom");
        if (sql.includes("FROM Config")) return [{ codigoEmpresa: 1, nome: "Centro" }, { codigoEmpresa: 2, nome: "Norte" }] as T[];
        if (sql.includes("MAX(CONVERT(varchar(19), c.DataNota, 120))")) return entradasPadrao as T[];
        if (sql.includes("FROM Produto_Estoque pe")) return estoquesPadrao as T[];
        if (sql.includes("FROM Produto p")) return produtosPadrao as T[];
        return [] as T[];
      },
    }),
  });

  const req = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  return { req, store, log };
}

describe("Rotas do Falteiro", () => {
  it("exige a permissão inovafarma:pedidos-falteiro:gerir", async () => {
    const { req } = boot({ permissions: [TODAS] });
    expect((await req("GET", "/pedidos/falteiro")).status).toBe(403);
    expect((await req("POST", "/pedidos/falteiro", { produtoId: "p-1", codigoLoja: 1 })).status).toBe(403);
  });

  it("respeita o escopo de Lojas: sem pedidos-todas-lojas:gerir só atua nas Lojas do Vínculo e não permite falta global", async () => {
    const { req, store } = boot({ permissions: [GERIR], lojasVinculo: [1] });

    // Pode criar na Loja 1 (do Vínculo)
    const ok = await req("POST", "/pedidos/falteiro", { produtoId: "p-1", codigoLoja: 1, quantidade: 4, observacao: "Acabou" });
    expect(ok.status).toBe(201);

    // Recusa criar na Loja 2 (fora do Vínculo) ou global (null)
    expect((await req("POST", "/pedidos/falteiro", { produtoId: "p-2", codigoLoja: 2 })).status).toBe(403);
    expect((await req("POST", "/pedidos/falteiro", { produtoId: "p-2", codigoLoja: null })).status).toBe(403);

    // Se já existir falta na Loja 2 ou global (criada por um comprador), não pode editar nem remover
    const deOutraLoja = await store.criar({ produtoId: "p-2", codigoLoja: 2, quantidade: 1, observacao: null }, { id: "g", nome: "Gil" });
    const global = await store.criar({ produtoId: "p-2", codigoLoja: null, quantidade: 1, observacao: null }, { id: "g", nome: "Gil" });

    expect((await req("PUT", `/pedidos/falteiro/${deOutraLoja.id}`, { codigoLoja: 2, quantidade: 2, observacao: null, version: 1 })).status).toBe(403);
    expect((await req("DELETE", `/pedidos/falteiro/${deOutraLoja.id}?version=1`)).status).toBe(403);
    expect((await req("PUT", `/pedidos/falteiro/${global.id}`, { codigoLoja: null, quantidade: 2, observacao: null, version: 1 })).status).toBe(403);
    expect((await req("DELETE", `/pedidos/falteiro/${global.id}?version=1`)).status).toBe(403);
  });

  it("com pedidos-todas-lojas:gerir permite criar, editar e remover faltas de qualquer Loja ou de Todas as Lojas e registra no Audit Log", async () => {
    const { req, log } = boot({ permissions: [GERIR, TODAS] });

    const criada = await req("POST", "/pedidos/falteiro", { produtoId: "p-1", codigoLoja: null, quantidade: 12, observacao: "Todas as Lojas" });
    expect(criada.status).toBe(201);
    const item = (await criada.json()) as { id: string; version: number };

    // Duplicidade retorna 409
    expect((await req("POST", "/pedidos/falteiro", { produtoId: "p-1", codigoLoja: null })).status).toBe(409);

    // Edição com version e 409 em conflito
    expect((await req("PUT", `/pedidos/falteiro/${item.id}`, { codigoLoja: 2, quantidade: 6, observacao: "Só Norte", version: 99 })).status).toBe(409);
    const editada = await req("PUT", `/pedidos/falteiro/${item.id}`, { codigoLoja: 2, quantidade: 6, observacao: "Só Norte", version: 1 });
    expect(editada.status).toBe(200);
    expect(await editada.json()).toMatchObject({ codigoLoja: 2, quantidade: 6, observacao: "Só Norte", version: 2 });

    // Remoção com version e 409 em conflito
    expect((await req("DELETE", `/pedidos/falteiro/${item.id}?version=1`)).status).toBe(409);
    expect((await req("DELETE", `/pedidos/falteiro/${item.id}?version=2`)).status).toBe(204);
    expect(log).toHaveLength(3);
    expect(log[0]).toContain("DIPIRONA 500MG");
  });

  it("calcula estoque atual e só sugere remoção quando estoque > 0 E houve entrada de NF (Compra) após criadoEm", async () => {
    // Criamos registros na store e simulamos respostas do ERP
    const { req, store } = boot({
      erp: {
        estoques: [
          { produtoId: "p-1", codigoLoja: 1, estoque: 5 },
          { produtoId: "p-1", codigoLoja: 2, estoque: 0 },
          { produtoId: "p-2", codigoLoja: 1, estoque: 0 },
        ],
        entradas: [
          // Entrada de NF em 2999-12-31 (sempre posterior à criação do registro) na Loja 1 para p-1 e p-2
          { produtoId: "p-1", codigoLoja: 1, ultimaEntrada: "2999-12-31 10:00:00" },
          // Na Loja 2, entrada antiga anterior à criação
          { produtoId: "p-1", codigoLoja: 2, ultimaEntrada: "2000-01-01 10:00:00" },
          // p-2 teve entrada recente na Loja 1, mas o estoque atual é 0
          { produtoId: "p-2", codigoLoja: 1, ultimaEntrada: "2999-12-31 10:00:00" },
        ],
      },
    });

    const f1 = await store.criar({ produtoId: "p-1", codigoLoja: 1, quantidade: 4, observacao: null }, { id: "u", nome: "Ana" });
    const f2 = await store.criar({ produtoId: "p-1", codigoLoja: 2, quantidade: 2, observacao: null }, { id: "u", nome: "Ana" });
    const fGlobal = await store.criar({ produtoId: "p-1", codigoLoja: null, quantidade: 10, observacao: null }, { id: "u", nome: "Ana" });
    const fSemEstoque = await store.criar({ produtoId: "p-2", codigoLoja: 1, quantidade: 3, observacao: null }, { id: "u", nome: "Ana" });

    const res = await req("GET", "/pedidos/falteiro");
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as {
      todasAsLojas: boolean;
      itens: { id: string; estoque: number; entradaAposCriacao: boolean; sugerirRemocao: boolean }[];
    };

    const porId = new Map(corpo.itens.map((i) => [i.id, i]));
    // Loja 1 de p-1: estoque 5 (> 0) e entrada pós-criação -> sugere remoção!
    expect(porId.get(f1.id)).toMatchObject({ estoque: 5, entradaAposCriacao: true, sugerirRemocao: true });
    // Loja 2 de p-1: estoque 0 e entrada antiga -> não sugere
    expect(porId.get(f2.id)).toMatchObject({ estoque: 0, entradaAposCriacao: false, sugerirRemocao: false });
    // Global de p-1: estoque total = 5 + 0 = 5 (> 0) e houve entrada pós-criação na Loja 1 -> sugere remoção!
    expect(porId.get(fGlobal.id)).toMatchObject({ estoque: 5, entradaAposCriacao: true, sugerirRemocao: true });
    // Loja 1 de p-2: houve entrada pós-criação, mas estoque atual é 0 -> NÃO sugere remoção!
    expect(porId.get(fSemEstoque.id)).toMatchObject({ estoque: 0, entradaAposCriacao: true, sugerirRemocao: false });
  });

  it("busca qualquer produto do ERP pelo nome ou código de barras", async () => {
    const { req } = boot();
    expect(await (await req("GET", "/pedidos/falteiro/produtos?q=di")).json()).toEqual([]);
    const res = await req("GET", "/pedidos/falteiro/produtos?q=dipirona");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "p-1", nome: "DIPIRONA 500MG", codigoBarra: "7891" },
      { id: "p-2", nome: "AAS 100MG", codigoBarra: null },
    ]);
  });
});
