import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { declareConfirmacaoAudit } from "./pedidos-confirmacao-audit";
import { registerConfirmacaoRoutes } from "./pedidos-confirmacao-routes";
import { itensDoFornecedor } from "./pedido-pdf";
import { MemoryCotacaoStore } from "./cotacao-store";
import { declarePedidosAudit } from "./pedidos-audit";
import { MemoryPedidoStore } from "./pedidos-store";
import type { Pedido } from "./pedidos";
import type { AuditService } from "./vinculo-audit";

const CONFIRMAR = "inovafarma:pedidos-pedidos:confirmar";
const GERIR = "inovafarma:pedidos-pedidos:gerir";
const dipirona = { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", quantidades: [{ codigoLoja: 1, quantidade: 10 }, { codigoLoja: 2, quantidade: 3 }] };
const aas = { produtoId: "p-2", nome: "AAS", codigoBarra: null, quantidades: [{ codigoLoja: 1, quantidade: 3 }] };
const raro = { produtoId: "p-3", nome: "RARO", codigoBarra: null, quantidades: [{ codigoLoja: 1, quantidade: 1 }] };

interface Opcoes {
  erpFalha?: boolean;
  semNome?: boolean;
  /** Linhas de Compra_Produto devolvidas pelo ERP. */
  entradas?: { produtoId: string; codigoLoja: number; recebida: number }[];
}

async function boot({ erpFalha = false, semNome = false, entradas = [] }: Opcoes = {}) {
  const app = new Hono();
  const pedidos = new MemoryPedidoStore();
  const cotacoes = new MemoryCotacaoStore();
  const resumos = new Map<string, (a: never) => string>();
  const log: string[] = [];
  const consultas: { sql: string; params?: Record<string, unknown> }[] = [];
  const audit: AuditService = {
    declareAction: (def) => void resumos.set(def.action, def.summary as (a: never) => string),
    record: async (input) => void log.push(resumos.get(input.action)?.(input.attributes as never) ?? "?"),
  };
  declarePedidosAudit(audit);
  declareConfirmacaoAudit(audit);
  const auth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("x-user") ?? "";
    c.set("user" as never, { sub, fullname: sub, permissions: sub === "gil" ? [CONFIRMAR, GERIR] : sub === "bia" ? [GERIR] : [] } as never);
    await next();
  };
  registerConfirmacaoRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    audit,
    pedidos,
    cotacoes,
    erpClient: () => ({
      query: async <T,>(sql: string, params?: Record<string, unknown>) => {
        consultas.push({ sql, params });
        if (erpFalha) throw new Error("boom");
        if (sql.includes("FROM Fornecedor")) return (semNome ? [] : [{ codigo: 9, nome: "BETA" }, { codigo: 7, nome: "ALFA" }]) as T[];
        return entradas.map((e) => ({ dia: "2999-01-01", ...e })) as T[];
      },
    }),
  });
  const req = (who: string, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "x-user": who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const criado = await pedidos.criar({ itens: [dipirona, aas, raro] }, { id: "gil", nome: "gil" });
  await pedidos.iniciarCotacao(criado.id, 1);
  await cotacoes.criar(criado.id, [7, 9]);
  await cotacoes.gravarPrecos(criado.id, 7, { "p-1": 12.5, "p-2": 5, "p-3": null }, 1);
  await cotacoes.gravarPrecos(criado.id, 9, { "p-1": 11, "p-2": null, "p-3": null }, 1);
  const cotado = (await pedidos.marcarCotado(criado.id)) as Pedido;
  return { req, log, consultas, pedidos, id: cotado.id, version: cotado.version };
}

type Boot = Awaited<ReturnType<typeof boot>>;
const confirmar = (b: Boot, corpo: unknown = { escolhas: { "p-1": 9, "p-2": 7 }, version: b.version }, who = "gil") => b.req(who, "POST", `/pedidos/pedidos/${b.id}/confirmar`, corpo);
const pdf = (b: Boot, codigo: number, who = "gil") => b.req(who, "GET", `/pedidos/pedidos/${b.id}/pdf/${codigo}`);
const conferir = (b: Boot, who = "gil") => b.req(who, "POST", `/pedidos/pedidos/${b.id}/conferir`);

describe("Confirmação do Pedido", () => {
  it("confirma com o fornecedor escolhido por produto, registra no Audit Log e guarda a escolha", async () => {
    const b = await boot();
    const res = await confirmar(b);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "confirmado", escolhas: { "p-1": 9, "p-2": 7 }, version: b.version + 1 });
    expect(b.log).toEqual(["Confirmou o Pedido: 2 produtos em 2 fornecedores."]);
  });

  it("deixa fora o produto que ninguém cotou", async () => {
    const b = await boot();
    expect(((await (await confirmar(b)).json()) as Pedido).escolhas["p-3"]).toBeUndefined();
  });

  it("recusa versão antiga com 409 e não confirma", async () => {
    const b = await boot();
    const res = await confirmar(b, { escolhas: { "p-1": 9, "p-2": 7 }, version: b.version - 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "versao_desatualizada" });
    expect((await b.pedidos.pedido(b.id))?.status).toBe("cotado");
  });

  it("recusa confirmar duas vezes (409)", async () => {
    const b = await boot();
    await confirmar(b);
    expect((await confirmar(b, { escolhas: { "p-1": 9, "p-2": 7 }, version: b.version + 1 })).status).toBe(409);
  });

  it("recusa escolha de fornecedor sem preço para o produto, produto sem escolha e produto fora do Pedido (400)", async () => {
    const b = await boot();
    expect((await confirmar(b, { escolhas: { "p-1": 9, "p-2": 9 }, version: b.version })).status).toBe(400);
    expect((await confirmar(b, { escolhas: { "p-1": 9 }, version: b.version })).status).toBe(400);
    expect((await confirmar(b, { escolhas: { "p-1": 9, "p-2": 7, "p-9": 7 }, version: b.version })).status).toBe(400);
  });

  it("exige a Permission de confirmar (403) e o Pedido existente (404)", async () => {
    const b = await boot();
    expect((await confirmar(b, undefined, "bia")).status).toBe(403);
    expect((await b.req("gil", "POST", "/pedidos/pedidos/nada/confirmar", { escolhas: {}, version: 1 })).status).toBe(404);
  });
});

describe("PDF por fornecedor", () => {
  it("lista só os itens escolhidos no fornecedor, com quantidade total e preço", () => {
    const pedido = { itens: [dipirona, aas, raro], escolhas: { "p-1": 9, "p-2": 7 } };
    expect(itensDoFornecedor(pedido, 7, { "p-1": 12.5, "p-2": 5, "p-3": null })).toEqual([{ nome: "AAS", quantidade: 3, preco: 5 }]);
    expect(itensDoFornecedor(pedido, 9, { "p-1": 11, "p-2": null })).toEqual([{ nome: "DIPIRONA", quantidade: 13, preco: 11 }]);
  });

  it("gera o PDF do fornecedor em base64 depois de confirmado", async () => {
    const b = await boot();
    await confirmar(b);
    const res = await pdf(b, 9);
    expect(res.status).toBe(200);
    const { nome, conteudo } = (await res.json()) as { nome: string; conteudo: string };
    expect(nome).toBe("pedido-9.pdf");
    expect(Buffer.from(conteudo, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("bloqueia com mensagem clara quando o nome do fornecedor não vem do ERP", async () => {
    for (const opcoes of [{ erpFalha: true }, { semNome: true }]) {
      const b = await boot(opcoes);
      await confirmar(b);
      const res = await pdf(b, 9);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toContain("nome do fornecedor");
    }
  });

  it("recusa antes da confirmação (409), fornecedor sem itens escolhidos (404) e sem Permission (403)", async () => {
    const b = await boot();
    expect((await pdf(b, 9)).status).toBe(409);
    await confirmar(b);
    expect((await pdf(b, 3)).status).toBe(404);
    expect((await pdf(b, 9, "bia")).status).toBe(403);
  });
});

describe("Conferência com a NF", () => {
  it("consulta Compra/Compra_Produto do produto e da Loja, não eliminadas, desde a data do Pedido", async () => {
    const b = await boot();
    await confirmar(b);
    await conferir(b);
    const compra = b.consultas.find((q) => q.sql.includes("FROM Compra"));
    expect(compra?.sql).toMatch(/c\.Eliminado = 0/);
    expect(compra?.sql).toMatch(/c\.DataNota >= @desde/);
    expect(compra?.sql).toMatch(/c\.CodigoEmpresa/);
    expect(compra?.sql).not.toMatch(/Compra_Pedido/);
    expect(compra?.params).toMatchObject({ p0: "p-1", p1: "p-2" });
    expect(String(compra?.params?.desde)).toMatch(/^\d{4}-\d{2}-\d{2} 00:00:00$/);
  });

  it("calcula os estados por produto e Loja e leva o Pedido a parcialmente recebido", async () => {
    const b = await boot({ entradas: [{ produtoId: "p-1", codigoLoja: 1, recebida: 10 }, { produtoId: "p-2", codigoLoja: 1, recebida: 5 }] });
    await confirmar(b);
    const res = await conferir(b);
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { pedido: Pedido; linhas: { produtoId: string; codigoLoja: number; estado: string }[] };
    expect(corpo.pedido.status).toBe("parcialmente_recebido");
    expect(corpo.linhas.map((l) => [l.produtoId, l.codigoLoja, l.estado])).toEqual([["p-1", 1, "recebido"], ["p-1", 2, "pendente"], ["p-2", 1, "excedente"]]);
    expect(b.log).toContain("Conferiu o Pedido com a NF: parcialmente recebido.");
  });

  it("leva o Pedido a recebido quando tudo entrou", async () => {
    const b = await boot({ entradas: [{ produtoId: "p-1", codigoLoja: 1, recebida: 10 }, { produtoId: "p-1", codigoLoja: 2, recebida: 3 }, { produtoId: "p-2", codigoLoja: 1, recebida: 3 }] });
    await confirmar(b);
    expect(((await (await conferir(b)).json()) as { pedido: Pedido }).pedido.status).toBe("recebido");
  });

  it("não confere antes da confirmação (409), sem Permission (403) e com ERP fora (503)", async () => {
    const b = await boot();
    expect((await conferir(b)).status).toBe(409);
    expect((await conferir(b, "ana")).status).toBe(403);
    const c = await boot({ erpFalha: true });
    await confirmar(c);
    expect((await conferir(c)).status).toBe(503);
  });
});
