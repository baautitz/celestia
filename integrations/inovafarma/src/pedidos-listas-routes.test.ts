import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerPedidosListasRoutes } from "./pedidos-listas-routes";
import { declarePedidosListasAudit } from "./pedidos-listas-audit";
import { MemoryPedidosListasStore } from "./pedidos-listas-store";
import type { ListaPedidos } from "./pedidos-listas";
import type { AuditService } from "./vinculo-audit";
import { defined } from "./test/defined";

const GERIR = "inovafarma:pedidos-listas:gerir";
const vitaminas = { nome: "Vitaminas", entradas: [{ tipo: "grupo", id: "44", nome: "VITAMINAS" }] };

function boot() {
  const app = new Hono();
  const store = new MemoryPedidosListasStore();
  const resumos = new Map<string, (a: never) => string>();
  const log: string[] = [];
  const audit: AuditService = {
    declareAction: (def) => void resumos.set(def.action, def.summary as (a: never) => string),
    record: async (input) => void log.push(defined(resumos.get(input.action), "the audit summary")(input.attributes as never)),
  };
  declarePedidosListasAudit(audit);
  const auth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("x-user") ?? "";
    c.set("user" as never, { sub, fullname: sub, permissions: sub === "gil" ? [GERIR] : [] } as never);
    await next();
  };
  registerPedidosListasRoutes({ routes: app, permissions: { has: (p, k) => Boolean(p?.includes(k)) }, auth, store, audit });
  const req = (who: string, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "x-user": who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { req, log };
}

describe("Listas de produtos de Pedidos", () => {
  it("exige a Permission", async () => {
    const { req } = boot();
    expect((await req("ana", "GET", "/pedidos/listas")).status).toBe(403);
    expect((await req("ana", "POST", "/pedidos/listas", vitaminas)).status).toBe(403);
  });

  it("cria, lista por nome e registra no Audit Log", async () => {
    const { req, log } = boot();
    expect((await req("gil", "POST", "/pedidos/listas", { nome: "Zinco", entradas: [] })).status).toBe(201);
    expect((await req("gil", "POST", "/pedidos/listas", vitaminas)).status).toBe(201);
    const lista = (await (await req("gil", "GET", "/pedidos/listas")).json()) as ListaPedidos[];
    expect(lista.map((l) => l.nome)).toEqual(["Vitaminas", "Zinco"]);
    expect(log[1]).toBe('Criou a lista de produtos "Vitaminas" de Pedidos: Grupo VITAMINAS.');
  });

  it("recusa nome repetido, entrada duplicada e id inválido", async () => {
    const { req } = boot();
    expect((await req("gil", "POST", "/pedidos/listas", vitaminas)).status).toBe(201);
    expect((await req("gil", "POST", "/pedidos/listas", { ...vitaminas, nome: "vitaminas" })).status).toBe(409);
    expect((await req("gil", "POST", "/pedidos/listas", { nome: "Dupla", entradas: [...vitaminas.entradas, ...vitaminas.entradas] })).status).toBe(400);
    expect((await req("gil", "POST", "/pedidos/listas", { nome: "Ruim", entradas: [{ tipo: "grupo", id: "abc", nome: "X" }] })).status).toBe(400);
  });

  it("edita e exclui com controle de versão (409) e Audit Log", async () => {
    const { req, log } = boot();
    const criada = (await (await req("gil", "POST", "/pedidos/listas", vitaminas)).json()) as ListaPedidos;
    const editada = await req("gil", "PUT", `/pedidos/listas/${criada.id}`, { nome: "Vitaminas B", entradas: vitaminas.entradas, version: criada.version });
    expect(editada.status).toBe(200);
    expect(((await editada.json()) as ListaPedidos).version).toBe(2);
    expect(log[1]).toContain('nome de "Vitaminas" para "Vitaminas B"');
    const velha = await req("gil", "PUT", `/pedidos/listas/${criada.id}`, { nome: "Outra", entradas: [], version: criada.version });
    expect(velha.status).toBe(409);
    expect(((await velha.json()) as { code: string }).code).toBe("versao_desatualizada");
    expect((await req("gil", "DELETE", `/pedidos/listas/${criada.id}?version=1`)).status).toBe(409);
    expect((await req("gil", "DELETE", `/pedidos/listas/${criada.id}?version=2`)).status).toBe(204);
    expect(log[2]).toBe('Removeu a lista de produtos "Vitaminas B" de Pedidos (Grupo VITAMINAS).');
    expect((await req("gil", "PUT", `/pedidos/listas/${criada.id}`, { nome: "X", entradas: [], version: 3 })).status).toBe(404);
  });
});
