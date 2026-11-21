import type { MiddlewareHandler } from "hono";
import type { ModuleContext } from "@platform/core/module";
import { NomeDuplicadoError } from "./erros-de-store.js";
import { ator, recusaDeValidacao, Version, versaoDaQuery, versaoDesatualizada, type AuthContext } from "./metas-comum.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { PEDIDOS_PLUGIN } from "./pedidos-audit.js";
import { PEDIDO_LISTA_TARGET, PEDIDOS_LISTAS_ACTIONS } from "./pedidos-listas-audit.js";
import { DadosListaPedidos, descreverLista, problemaDaLista, type ListaPedidos } from "./pedidos-listas.js";
import type { PedidosListasStore } from "./pedidos-listas-store.js";
import type { AuditService } from "./vinculo-audit.js";
import type { z } from "zod";

export interface PedidosListasRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  store: PedidosListasStore;
  audit: AuditService;
}

const BASE = "/pedidos/listas";
const NAO_ENCONTRADA = "Lista não encontrada.";
const NOME_DUPLICADO = "Já existe uma lista com este nome.";
const VERSAO_DESATUALIZADA = versaoDesatualizada("A lista foi alterada por outra pessoa. As listas foram recarregadas.");
const Edicao = DadosListaPedidos.extend({ version: Version });

/** Listas de produtos de Pedidos: CRUD global com concorrência otimista e Audit Log. */
export function registerPedidosListasRoutes({ routes, permissions, auth, store, audit }: PedidosListasRoutesDeps): void {
  const gerir = INOVAFARMA_PERMISSIONS.ref("pedidos-listas:gerir");
  const pode = (c: AuthContext) => permissions.has(c.get("user")?.permissions, gerir.key);

  const valores = (l: Pick<ListaPedidos, "nome" | "entradas">) => ({ nome: l.nome, conteudo: descreverLista(l) });
  const registrar = (c: AuthContext, action: string, lista: ListaPedidos, anterior: ListaPedidos | null = null) =>
    audit.record({
      plugin: PEDIDOS_PLUGIN,
      action,
      actor: ator(c),
      target: { type: PEDIDO_LISTA_TARGET, id: lista.id },
      attributes: { ...valores(lista), anterior: anterior && valores(anterior) },
    });

  const ler = async <S extends typeof DadosListaPedidos | typeof Edicao>(c: AuthContext, schema: S) => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return { recusa: recusaDeValidacao(c, parsed.error) } as const;
    const problema = problemaDaLista(parsed.data);
    if (problema) return { recusa: c.json({ error: problema }, 400) } as const;
    return { dados: parsed.data as z.infer<S> } as const;
  };

  routes.get(BASE, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    return c.json(await store.listar());
  });

  routes.post(BASE, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const lido = await ler(c, DadosListaPedidos);
    if ("recusa" in lido) return lido.recusa;
    try {
      const criada = await store.criar(lido.dados);
      await registrar(c, PEDIDOS_LISTAS_ACTIONS.criar, criada);
      return c.json(criada, 201);
    } catch (err: unknown) {
      if (err instanceof NomeDuplicadoError) return c.json({ error: NOME_DUPLICADO }, 409);
      throw err;
    }
  });

  routes.put(`${BASE}/:id`, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const anterior = await store.lista(c.req.param("id") ?? "");
    if (!anterior) return c.json({ error: NAO_ENCONTRADA }, 404);
    const lido = await ler(c, Edicao);
    if ("recusa" in lido) return lido.recusa;
    const { version, ...dados } = lido.dados;
    try {
      const atualizada = await store.atualizar(anterior.id, dados, version);
      if (!atualizada) return c.json(VERSAO_DESATUALIZADA, 409);
      await registrar(c, PEDIDOS_LISTAS_ACTIONS.editar, atualizada, anterior);
      return c.json(atualizada);
    } catch (err: unknown) {
      if (err instanceof NomeDuplicadoError) return c.json({ error: NOME_DUPLICADO }, 409);
      throw err;
    }
  });

  routes.delete(`${BASE}/:id`, auth, async (c: AuthContext) => {
    if (!pode(c)) return c.json({ error: gerir.deniedMessage }, 403);
    const versao = versaoDaQuery(c);
    if ("recusa" in versao) return versao.recusa;
    const lista = await store.lista(c.req.param("id") ?? "");
    if (!lista) return c.json({ error: NAO_ENCONTRADA }, 404);
    if (!(await store.remover(lista.id, versao.version))) return c.json(VERSAO_DESATUALIZADA, 409);
    await registrar(c, PEDIDOS_LISTAS_ACTIONS.remover, lista);
    return c.body(null, 204);
  });
}
