import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { PEDIDO_TARGET, PEDIDOS_ACTIONS, PEDIDOS_PLUGIN } from "./pedidos-audit.js";
import { DadosPedido, type Pedido } from "./pedidos.js";
import type { PedidoStore } from "./pedidos-store.js";
import { ator, recusaDeValidacao, Version, versaoDesatualizada, type AuthContext } from "./metas-comum.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import type { AuditService } from "./vinculo-audit.js";

export interface PedidosRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  store: PedidoStore;
  audit: AuditService;
}

const BASE = "/pedidos/pedidos";
const NAO_ENCONTRADO = "Pedido não encontrado.";
const DESATUALIZADO = versaoDesatualizada("O Pedido foi alterado por outra pessoa ou já não pode ser editado. A lista foi recarregada.");
const Edicao = DadosPedido.and(z.object({ version: Version }));
const Cancelamento = z.object({ version: Version });

/** Pedidos em rascunho: gerados a partir dos produtos marcados no Lançamento, editados e cancelados aqui. */
export function registerPedidosRoutes({ routes, permissions, auth, store, audit }: PedidosRoutesDeps): void {
  const gerir = INOVAFARMA_PERMISSIONS.ref("pedidos-pedidos:gerir");
  const pode = (c: AuthContext) => permissions.has(c.get("user")?.permissions, gerir.key);

  const registrar = (c: AuthContext, action: string, pedido: Pedido) =>
    audit.record({ plugin: PEDIDOS_PLUGIN, action, actor: ator(c), target: { type: PEDIDO_TARGET, id: pedido.id }, attributes: { produtos: pedido.itens.length } });

  const ler = async <S extends z.ZodType>(c: AuthContext, schema: S) => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    return parsed.success ? ({ dados: parsed.data as z.infer<S> } as const) : ({ recusa: recusaDeValidacao(c, parsed.error) } as const);
  };

  routes.get(BASE, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    return c.json(await store.listar());
  });

  routes.post(BASE, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const lido = await ler(c, DadosPedido);
    if ("recusa" in lido) return lido.recusa;
    const autor = ator(c);
    const criado = await store.criar(lido.dados, { id: autor.id, nome: autor.name });
    await registrar(c, PEDIDOS_ACTIONS.gerar, criado);
    return c.json(criado, 201);
  });

  routes.put(`${BASE}/:id`, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const id = c.req.param("id") ?? "";
    if (!(await store.pedido(id))) return c.json({ error: NAO_ENCONTRADO }, 404);
    const lido = await ler(c, Edicao);
    if ("recusa" in lido) return lido.recusa;
    const { version, ...dados } = lido.dados;
    const editado = await store.atualizarRascunho(id, dados, version);
    if (!editado) return c.json(DESATUALIZADO, 409);
    await registrar(c, PEDIDOS_ACTIONS.editar, editado);
    return c.json(editado);
  });

  routes.post(`${BASE}/:id/cancelar`, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const id = c.req.param("id") ?? "";
    if (!(await store.pedido(id))) return c.json({ error: NAO_ENCONTRADO }, 404);
    const lido = await ler(c, Cancelamento);
    if ("recusa" in lido) return lido.recusa;
    const cancelado = await store.cancelar(id, lido.dados.version);
    if (!cancelado) return c.json(DESATUALIZADO, 409);
    await registrar(c, PEDIDOS_ACTIONS.cancelar, cancelado);
    return c.json(cancelado);
  });
}
