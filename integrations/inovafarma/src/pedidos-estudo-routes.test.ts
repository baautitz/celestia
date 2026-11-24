import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerPedidosEstudoRoutes } from "./pedidos-estudo-routes";

function boot({ permissions = ["inovafarma:pedidos-lancamento:ver"], falhaCompras = false, falhaTudo = false }: { permissions?: string[]; falhaCompras?: boolean; falhaTudo?: boolean } = {}) {
  const app = new Hono();
  const auth: MiddlewareHandler = async (c, next) => {
    c.set("user" as never, { sub: "ana", fullname: "Ana", permissions } as never);
    await next();
  };
  registerPedidosEstudoRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    erpClient: () => ({
      query: async <T,>(sql: string) => {
        if (falhaTudo) throw new Error("boom");
        if (sql.includes("FROM Compra c")) {
          if (falhaCompras) throw new Error("boom");
          return [{ mes: "2027-03", codigoLoja: 1, codigoFornecedor: 7, quantidade: 10, valor: 55 }] as T[];
        }
        if (sql.includes("FROM Fornecedor")) return [{ codigo: 7, nome: "EMS" }] as T[];
        return [{ mes: "2027-03", codigoLoja: 1, vendida: 12 }] as T[];
      },
    }),
  });
  return (path: string) => app.request(path);
}

describe("Estudo de produto", () => {
  it("traz as vendas por Loja e as compras por distribuidora", async () => {
    const res = await boot()("/pedidos/lancamento/estudo?produtoId=p-1");
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { vendas: unknown; compras: unknown };
    expect(corpo.vendas).toEqual([{ mes: "2027-03", codigoLoja: 1, vendida: 12 }]);
    expect(corpo.compras).toEqual([{ mes: "2027-03", codigoLoja: 1, codigoFornecedor: 7, fornecedor: "EMS", quantidade: 10, valor: 55 }]);
  });

  it("um bloco que falha vem nulo e o outro segue", async () => {
    const corpo = (await (await boot({ falhaCompras: true })("/pedidos/lancamento/estudo?produtoId=p-1")).json()) as { vendas: unknown; compras: unknown };
    expect(corpo.compras).toBeNull();
    expect(corpo.vendas).not.toBeNull();
  });

  it("responde 503 quando tudo falha, 400 sem produto e 403 sem permissão", async () => {
    expect((await boot({ falhaTudo: true })("/pedidos/lancamento/estudo?produtoId=p-1")).status).toBe(503);
    expect((await boot()("/pedidos/lancamento/estudo")).status).toBe(400);
    expect((await boot({ permissions: [] })("/pedidos/lancamento/estudo?produtoId=p-1")).status).toBe(403);
  });
});
