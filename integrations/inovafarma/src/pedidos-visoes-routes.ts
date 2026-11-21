import type { MiddlewareHandler } from "hono";
import type { ModuleContext } from "@platform/core/module";
import { NomeDuplicadoError } from "./erros-de-store.js";
import { recusaDeValidacao, Version, versaoDaQuery, versaoDesatualizada, type AuthContext } from "./metas-comum.js";
import { DadosVisaoPedidos } from "./pedidos-visoes.js";
import type { PedidosVisoesStore } from "./pedidos-visoes-store.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";

export interface PedidosVisoesRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  store: PedidosVisoesStore;
}

const BASE = "/pedidos/visoes";
const NAO_ENCONTRADA = "Visão não encontrada.";
const NOME_DUPLICADO = "Você já tem uma visão com este nome.";
const VERSAO_DESATUALIZADA = versaoDesatualizada("A visão foi alterada em outra tela. As visões foram recarregadas.");
const Edicao = DadosVisaoPedidos.extend({ version: Version });

/** Visões salvas do Lançamento: privadas por Usuário, sem Audit Log (preferência pessoal, sem efeito sobre dados). */
export function registerPedidosVisoesRoutes({ routes, permissions, auth, store }: PedidosVisoesRoutesDeps): void {
  const ver = INOVAFARMA_PERMISSIONS.ref("pedidos-lancamento:ver");
  const recusa = (c: AuthContext) => (permissions.has(c.get("user")?.permissions, ver.key) ? null : c.json({ error: ver.deniedMessage }, 403));
  const usuario = (c: AuthContext) => c.get("user")?.sub ?? "";

  routes.get(BASE, auth, async (c: AuthContext) => recusa(c) ?? c.json(await store.listar(usuario(c))));

  routes.post(BASE, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const parsed = DadosVisaoPedidos.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return recusaDeValidacao(c, parsed.error);
    try {
      return c.json(await store.criar(usuario(c), parsed.data), 201);
    } catch (err: unknown) {
      if (err instanceof NomeDuplicadoError) return c.json({ error: NOME_DUPLICADO }, 409);
      throw err;
    }
  });

  routes.put(`${BASE}/:id`, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const id = c.req.param("id") ?? "";
    if (!(await store.visao(usuario(c), id))) return c.json({ error: NAO_ENCONTRADA }, 404);
    const parsed = Edicao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return recusaDeValidacao(c, parsed.error);
    const { version, ...dados } = parsed.data;
    try {
      const atualizada = await store.atualizar(usuario(c), id, dados, version);
      return atualizada ? c.json(atualizada) : c.json(VERSAO_DESATUALIZADA, 409);
    } catch (err: unknown) {
      if (err instanceof NomeDuplicadoError) return c.json({ error: NOME_DUPLICADO }, 409);
      throw err;
    }
  });

  routes.delete(`${BASE}/:id`, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const versao = versaoDaQuery(c);
    if ("recusa" in versao) return versao.recusa;
    const id = c.req.param("id") ?? "";
    if (!(await store.visao(usuario(c), id))) return c.json({ error: NAO_ENCONTRADA }, 404);
    return (await store.remover(usuario(c), id, versao.version)) ? c.body(null, 204) : c.json(VERSAO_DESATUALIZADA, 409);
  });
}
