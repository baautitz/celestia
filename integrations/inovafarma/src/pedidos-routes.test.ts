import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerPedidosRoutes } from "./pedidos-routes";
import { declarePedidosAudit } from "./pedidos-audit";
import { MemoryPedidoStore } from "./pedidos-store";
import type { Pedido } from "./pedidos";
import type { AuditService } from "./vinculo-audit";
import { defined } from "./test/defined";

const GERIR = "inovafarma:pedidos-pedidos:gerir";
const dipirona = { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", quantidades: [{ codigoLoja: 1, quantidade: 10 }, { codigoLoja: 2, quantidade: 0 }] };
const aas = { produtoId: "p-2", nome: "AAS", codigoBarra: null, quantidades: [{ codigoLoja: 1, quantidade: 3 }] };

function boot() {
  const app = new Hono();
  const store = new MemoryPedidoStore();
  const resumos = new Map<string, (a: never) => string>();
  const log: string[] = [];
  const audit: AuditService = {
    declareAction: (def) => void resumos.set(def.action, def.summary as (a: never) => string),
    record: async (input) => void log.push(defined(resumos.get(input.action), "the audit summary")(input.attributes as never)),
  };
  declarePedidosAudit(audit);
  // "gil" gerencia os Pedidos, "ana" não.
  const auth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("x-user") ?? "";
    c.set("user" as never, { sub, fullname: sub, permissions: sub === "gil" ? [GERIR] : [] } as never);
    await next();
  };
  registerPedidosRoutes({ routes: app, permissions: { has: (p, k) => Boolean(p?.includes(k)) }, auth, store, audit });
  const req = (who: string, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "x-user": who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { req, log };
}

const criar = async (req: ReturnType<typeof boot>["req"], itens: unknown[] = [dipirona, aas]) => (await (await req("gil", "POST", "/pedidos/pedidos", { itens })).json()) as Pedido;

describe("Pedidos em rascunho", () => {
  it("gera o Pedido em rascunho com as quantidades por produto e Loja e registra no Audit Log", async () => {
    const { req, log } = boot();
    const res = await req("gil", "POST", "/pedidos/pedidos", { itens: [dipirona, aas] });
    expect(res.status).toBe(201);
    const pedido = (await res.json()) as Pedido;
    expect(pedido).toMatchObject({ status: "rascunho", version: 1, criadoPorNome: "gil" });
    expect(pedido.itens).toEqual([dipirona, aas]);
    const lista = (await (await req("gil", "GET", "/pedidos/pedidos")).json()) as Pedido[];
    expect(lista.map((p) => p.id)).toEqual([pedido.id]);
    expect(log).toEqual(["Gerou o Pedido em rascunho com 2 produtos."]);
  });

  it("exige a Permission", async () => {
    const { req } = boot();
    expect((await req("ana", "GET", "/pedidos/pedidos")).status).toBe(403);
    expect((await req("ana", "POST", "/pedidos/pedidos", { itens: [aas] })).status).toBe(403);
  });

  it("recusa Pedido sem itens, produto ou Loja repetidos e quantidade inválida", async () => {
    const { req } = boot();
    expect((await req("gil", "POST", "/pedidos/pedidos", { itens: [] })).status).toBe(400);
    expect((await req("gil", "POST", "/pedidos/pedidos", { itens: [aas, aas] })).status).toBe(400);
    expect((await req("gil", "POST", "/pedidos/pedidos", { itens: [{ ...aas, quantidades: [{ codigoLoja: 1, quantidade: 1 }, { codigoLoja: 1, quantidade: 2 }] }] })).status).toBe(400);
    expect((await req("gil", "POST", "/pedidos/pedidos", { itens: [{ ...aas, quantidades: [{ codigoLoja: 1, quantidade: -1 }] }] })).status).toBe(400);
    expect((await req("gil", "POST", "/pedidos/pedidos", { itens: [{ ...aas, quantidades: [{ codigoLoja: 1, quantidade: 1.5 }] }] })).status).toBe(400);
  });

  it("edita o rascunho com controle de versão (409) e registra a edição", async () => {
    const { req, log } = boot();
    const pedido = await criar(req);
    const itens = [{ ...aas, quantidades: [{ codigoLoja: 1, quantidade: 8 }] }];
    const editado = await req("gil", "PUT", `/pedidos/pedidos/${pedido.id}`, { itens, version: 1 });
    expect(editado.status).toBe(200);
    expect(await editado.json()).toMatchObject({ version: 2, itens });
    const velho = await req("gil", "PUT", `/pedidos/pedidos/${pedido.id}`, { itens, version: 1 });
    expect(velho.status).toBe(409);
    expect(await velho.json()).toMatchObject({ code: "versao_desatualizada" });
    expect((await req("gil", "PUT", "/pedidos/pedidos/nao-existe", { itens, version: 1 })).status).toBe(404);
    expect(log[1]).toBe("Editou o Pedido em rascunho: 1 produto.");
  });

  it("cancela o rascunho com controle de versão e não deixa editar nem cancelar de novo", async () => {
    const { req, log } = boot();
    const pedido = await criar(req);
    expect((await req("gil", "POST", `/pedidos/pedidos/${pedido.id}/cancelar`, { version: 9 })).status).toBe(409);
    const res = await req("gil", "POST", `/pedidos/pedidos/${pedido.id}/cancelar`, { version: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "cancelado", version: 2 });
    expect(log[1]).toBe("Cancelou o Pedido.");
    expect((await req("gil", "PUT", `/pedidos/pedidos/${pedido.id}`, { itens: [aas], version: 2 })).status).toBe(409);
    expect((await req("gil", "POST", `/pedidos/pedidos/${pedido.id}/cancelar`, { version: 2 })).status).toBe(409);
  });
});
