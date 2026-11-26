import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { authDoPedido, type EscopoLojasDeps } from "./pedidos-escopo-lojas.js";
import { MemoryPedidoStore } from "./pedidos-store.js";

const itens = (...lojas: number[]) => [{ produtoId: "p-1", nome: "P", codigoBarra: null, quantidades: lojas.map((codigoLoja) => ({ codigoLoja, quantidade: 1 })) }];

async function montar({ todas = false, lojas }: { todas?: boolean; lojas?: number[] }) {
  const pedidos = new MemoryPedidoStore();
  const deLoja1 = await pedidos.criar({ itens: itens(1) }, { id: "u", nome: "u" });
  const deDuas = await pedidos.criar({ itens: itens(1, 2) }, { id: "u", nome: "u" });
  const vinculos: EscopoLojasDeps["vinculos"] = { porUsuario: async () => (lojas ? { lojas, usuarioId: "u", codigoColaborador: 1, version: 1 } : null) };
  const auth = authDoPedido({
    permissions: { has: () => todas },
    auth: async (c, next) => {
      c.set("user", { sub: "u" });
      await next();
    },
    vinculos,
    pedidos,
  });
  const app = new Hono();
  app.get("/pedidos/:id", auth, (c) => c.text("ok"));
  app.post("/pedidos", auth, (c) => c.text("ok"));
  app.post("/pedidos/:id/cancelar", auth, (c) => c.text("ok"));
  const gerar = (...l: number[]) => app.request("/pedidos", { method: "POST", body: JSON.stringify({ itens: itens(...l) }) });
  const cancelar = (id: string) => app.request(`/pedidos/${id}/cancelar`, { method: "POST", body: "{}" });
  return { app, gerar, cancelar, deLoja1, deDuas };
}

describe("recorte de Pedidos por Loja", () => {
  it("gera e cancela só quando todas as Lojas do Pedido são do Vínculo; consultar é livre", async () => {
    const { app, gerar, cancelar, deLoja1, deDuas } = await montar({ lojas: [1] });
    expect((await gerar(1)).status).toBe(200);
    expect((await gerar(1, 2)).status).toBe(403);
    expect((await cancelar(deLoja1.id)).status).toBe(200);
    expect((await cancelar(deDuas.id)).status).toBe(403);
    expect((await app.request(`/pedidos/${deDuas.id}`)).status).toBe(200);
  });

  it("sem Vínculo não altera nada, e a Permission de todas as Lojas libera", async () => {
    expect((await (await montar({})).gerar(1)).status).toBe(403);
    expect((await (await montar({ todas: true })).gerar(1, 2)).status).toBe(200);
  });
});
