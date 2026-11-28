import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerPedidosVisoesRoutes } from "./pedidos-visoes-routes";
import { MemoryPedidosVisoesStore } from "./pedidos-visoes-store";
import type { VisaoPedidos } from "./pedidos-visoes";

const VER = "inovafarma:pedidos-lancamento:ver";
const base = { nome: "Genéricos Centro", lojas: [1], entradas: [{ tipo: "laboratorio", id: "7", nome: "EMS" }, { tipo: "secao", id: "9", nome: "GENERICOS" }], apenasComMinimo: true, padrao: false };

function boot() {
  const app = new Hono();
  const auth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("x-user") ?? "";
    c.set("user" as never, { sub, fullname: sub, permissions: sub === "sem" ? [] : [VER] } as never);
    await next();
  };
  registerPedidosVisoesRoutes({ routes: app, permissions: { has: (p, k) => Boolean(p?.includes(k)) }, auth, store: new MemoryPedidosVisoesStore() });
  const req = (who: string, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "x-user": who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { req };
}

describe("Visões salvas de Pedidos", () => {
  it("exige a Permission do Lançamento", async () => {
    expect((await boot().req("sem", "GET", "/pedidos/visoes")).status).toBe(403);
  });

  it("guarda os filtros, nunca a data, e só mostra as visões do próprio usuário", async () => {
    const { req } = boot();
    const criada = (await (await req("ana", "POST", "/pedidos/visoes", { ...base, de: "2027-01-01", ate: "2027-01-02" })).json()) as Record<string, unknown>;
    expect(criada).toMatchObject({
      nome: "Genéricos Centro",
      lojas: [1],
      entradas: base.entradas,
      apenasComMinimo: true,
      falteiro: "incluir",
      incluirSemVenda: false,
    });
    expect(criada).not.toHaveProperty("de");
    expect(criada).not.toHaveProperty("ate");
    expect(((await (await req("ana", "GET", "/pedidos/visoes")).json()) as VisaoPedidos[]).length).toBe(1);
    expect(((await (await req("bia", "GET", "/pedidos/visoes")).json()) as VisaoPedidos[]).length).toBe(0);
  });

  it("persiste os filtros de Falteiro e de produtos sem venda na visão e exige recorte ativo quando incluirSemVenda é verdadeiro", async () => {
    const { req } = boot();
    const semRecorte = await req("ana", "POST", "/pedidos/visoes", {
      ...base,
      nome: "Sem Recorte",
      entradas: [],
      apenasComMinimo: false,
      incluirSemVenda: true,
    });
    expect(semRecorte.status).toBe(400);

    const res = await req("ana", "POST", "/pedidos/visoes", { ...base, nome: "Faltas Sem Venda", falteiro: "somente", incluirSemVenda: true });
    expect(res.status).toBe(201);
    const criada = (await res.json()) as VisaoPedidos;
    expect(criada.falteiro).toBe("somente");
    expect(criada.incluirSemVenda).toBe(true);
  });

  it("recusa nome repetido do mesmo usuário, mas aceita o de outro", async () => {
    const { req } = boot();
    expect((await req("ana", "POST", "/pedidos/visoes", base)).status).toBe(201);
    expect((await req("ana", "POST", "/pedidos/visoes", { ...base, nome: "genéricos centro" })).status).toBe(409);
    expect((await req("bia", "POST", "/pedidos/visoes", base)).status).toBe(201);
  });

  it("mantém uma só visão padrão por usuário", async () => {
    const { req } = boot();
    const a = (await (await req("ana", "POST", "/pedidos/visoes", { ...base, padrao: true })).json()) as VisaoPedidos;
    const b = (await (await req("ana", "POST", "/pedidos/visoes", { ...base, nome: "Outra", padrao: true })).json()) as VisaoPedidos;
    const lista = (await (await req("ana", "GET", "/pedidos/visoes")).json()) as VisaoPedidos[];
    expect(lista.filter((v) => v.padrao).map((v) => v.id)).toEqual([b.id]);
    expect(lista.find((v) => v.id === a.id)?.padrao).toBe(false);
    const outra = (await (await req("bia", "POST", "/pedidos/visoes", { ...base, padrao: true })).json()) as VisaoPedidos;
    expect(outra.padrao).toBe(true);
    expect(((await (await req("ana", "GET", "/pedidos/visoes")).json()) as VisaoPedidos[]).filter((v) => v.padrao).length).toBe(1);
  });

  it("edita e exclui com controle de versão, só as próprias", async () => {
    const { req } = boot();
    const v = (await (await req("ana", "POST", "/pedidos/visoes", base)).json()) as VisaoPedidos;
    expect((await req("bia", "PUT", `/pedidos/visoes/${v.id}`, { ...base, version: 1 })).status).toBe(404);
    expect((await req("bia", "DELETE", `/pedidos/visoes/${v.id}?version=1`)).status).toBe(404);
    const editada = await req("ana", "PUT", `/pedidos/visoes/${v.id}`, { ...base, nome: "Nova", padrao: true, version: 1 });
    expect(((await editada.json()) as VisaoPedidos).version).toBe(2);
    expect((await req("ana", "PUT", `/pedidos/visoes/${v.id}`, { ...base, version: 1 })).status).toBe(409);
    expect((await req("ana", "DELETE", `/pedidos/visoes/${v.id}?version=1`)).status).toBe(409);
    expect((await req("ana", "DELETE", `/pedidos/visoes/${v.id}?version=2`)).status).toBe(204);
  });
});
