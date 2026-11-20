import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerColunasDesempenhoRoutes } from "./colunas-desempenho-routes";
import { declareColunasDesempenhoAudit } from "./colunas-desempenho-audit";
import { MemoryColunaDesempenhoStore } from "./colunas-desempenho-store";
import type { ColunaDesempenho } from "./colunas-desempenho";
import { condicaoDaColuna, desempenhoSql } from "./desempenho-vendas";
import type { AuditService } from "./vinculo-audit";
import { defined } from "./test/defined";

const MANAGE = "inovafarma:colunas-desempenho:manage";
const vitaminas = { nome: "Vitaminas", entradas: [{ tipo: "grupo", id: "44", nome: "VITAMINAS" }], uniao: [] as string[] };
const similares = { nome: "Similares", entradas: [{ tipo: "secao", id: "271", nome: "SIMILARES" }], uniao: [] as string[] };

function boot() {
  const app = new Hono();
  const store = new MemoryColunaDesempenhoStore();
  const resumos = new Map<string, (a: never) => string>();
  const log: string[] = [];
  const audit: AuditService = {
    declareAction: (def) => void resumos.set(def.action, def.summary as (a: never) => string),
    record: async (input) => void log.push(defined(resumos.get(input.action), "the audit summary")(input.attributes as never)),
  };
  declareColunasDesempenhoAudit(audit);
  // "gil" gerencia as colunas, "ana" não.
  const auth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("x-user") ?? "";
    c.set("user" as never, { sub, fullname: sub, permissions: sub === "gil" ? [MANAGE] : [] } as never);
    await next();
  };
  registerColunasDesempenhoRoutes({ routes: app, permissions: { has: (p, k) => Boolean(p?.includes(k)) }, auth, store, audit });
  const req = (who: string, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "x-user": who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { req, store, log };
}

describe("Colunas do Desempenho de Vendas", () => {
  it("cria, lista na ordem de criação e registra no Audit Log", async () => {
    const { req, log } = boot();
    expect((await req("gil", "POST", "/colunas-desempenho", vitaminas)).status).toBe(201);
    expect((await req("gil", "POST", "/colunas-desempenho", similares)).status).toBe(201);
    const lista = (await (await req("gil", "GET", "/colunas-desempenho")).json()) as ColunaDesempenho[];
    expect(lista.map((c) => c.nome)).toEqual(["Vitaminas", "Similares"]);
    expect(log[0]).toBe('Criou a coluna "Vitaminas" do Desempenho de Vendas: Grupo VITAMINAS.');
  });

  it("guarda as medidas escolhidas, usa as padrão sem escolha e recusa medida repetida ou nenhuma", async () => {
    const { req } = boot();
    const padrao = (await (await req("gil", "POST", "/colunas-desempenho", vitaminas)).json()) as ColunaDesempenho;
    expect(padrao.medidas).toEqual(["quantidade", "valor", "participacaoPercent", "cmvPercent", "ticketMedio"]);
    const escolhidas = (await (await req("gil", "POST", "/colunas-desempenho", { ...similares, medidas: ["cmv", "valor"] })).json()) as ColunaDesempenho;
    expect(escolhidas.medidas).toEqual(["cmv", "valor"]);
    expect((await req("gil", "POST", "/colunas-desempenho", { ...similares, nome: "Sem medida", medidas: [] })).status).toBe(400);
    expect((await req("gil", "POST", "/colunas-desempenho", { ...similares, nome: "Repetida", medidas: ["valor", "valor"] })).status).toBe(400);
  });

  it("exige a Permission e recusa coluna vazia, id inválido e nome repetido", async () => {
    const { req } = boot();
    expect((await req("ana", "GET", "/colunas-desempenho")).status).toBe(403);
    expect((await req("gil", "POST", "/colunas-desempenho", { nome: "Vazia", entradas: [], uniao: [] })).status).toBe(400);
    expect((await req("gil", "POST", "/colunas-desempenho", { ...vitaminas, entradas: [{ tipo: "grupo", id: "abc", nome: "X" }] })).status).toBe(400);
    expect((await req("gil", "POST", "/colunas-desempenho", vitaminas)).status).toBe(201);
    expect((await req("gil", "POST", "/colunas-desempenho", { ...vitaminas, nome: "vitaminas" })).status).toBe(409);
  });

  it("une colunas sem aceitar união de união e protege a coluna usada, com controle de versão", async () => {
    const { req } = boot();
    const v = (await (await req("gil", "POST", "/colunas-desempenho", vitaminas)).json()) as ColunaDesempenho;
    const total = (await (await req("gil", "POST", "/colunas-desempenho", { nome: "Total", entradas: [], uniao: [v.id] })).json()) as ColunaDesempenho;
    expect((await req("gil", "POST", "/colunas-desempenho", { nome: "Dupla", entradas: [], uniao: [total.id] })).status).toBe(400);
    expect((await req("gil", "POST", "/colunas-desempenho", { nome: "Fantasma", entradas: [], uniao: ["nao-existe"] })).status).toBe(400);
    expect((await req("gil", "DELETE", `/colunas-desempenho/${v.id}?version=${v.version}`)).status).toBe(409);
    expect((await req("gil", "PUT", `/colunas-desempenho/${total.id}`, { nome: "Total", entradas: [], uniao: [v.id], version: 99 })).status).toBe(409);
    expect((await req("gil", "DELETE", `/colunas-desempenho/${total.id}?version=${total.version}`)).status).toBe(204);
    expect((await req("gil", "DELETE", `/colunas-desempenho/${v.id}?version=${v.version}`)).status).toBe(204);
  });
});

describe("SQL das colunas", () => {
  const coluna = (id: string, entradas: ColunaDesempenho["entradas"], uniao: string[] = []): ColunaDesempenho => ({ id, nome: id, entradas, uniao, ordem: 1, version: 1, criadoEm: "", atualizadoEm: "" });

  it("une as entradas por OR, com os ids por parâmetro e sem colidir entre colunas", () => {
    const a = coluna("a", vitaminas.entradas);
    const b = coluna("b", similares.entradas);
    const total = coluna("t", [], ["a", "b"]);
    const { sql, params } = desempenhoSql("", [a, b, total]);
    expect(params).toEqual({ col0_grupo0: 44, col1_secao0: 271, col2_grupo0: 44, col2_secao0: 271 });
    expect(sql).toContain("(p.CodigoGrupo IN (@col2_grupo0) OR p.CodigoSessao IN (@col2_secao0))");
    expect(sql).toContain("AS colValor2");
    expect(sql).not.toMatch(/IN \(44\)/);
    expect(condicaoDaColuna(coluna("x", []), [], 0, {})).toBe("1 = 0");
  });
});
