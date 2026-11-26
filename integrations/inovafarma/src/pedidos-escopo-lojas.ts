import type { MiddlewareHandler } from "hono";
import type { ModuleContext } from "@platform/core/module";
import { vinculoDoUsuario, type AuthContext } from "./metas-comum.js";
import type { PedidoStore } from "./pedidos-store.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import type { VinculoStore } from "./vinculo-store.js";

export interface EscopoLojasDeps {
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  vinculos: Pick<VinculoStore, "porUsuario">;
  pedidos: PedidoStore;
}

export const FORA_DO_ESCOPO = "Acesso negado: há Loja fora do seu acesso neste Pedido.";

/** As Lojas de destino do Pedido; a Loja que só fornece a transferência não conta. */
export const lojasDoPedido = (itens: readonly { quantidades: readonly { codigoLoja: number; quantidade: number }[] }[]) =>
  [...new Set(itens.flatMap((i) => i.quantidades.filter((q) => q.quantidade > 0).map((q) => q.codigoLoja)))];

/** As Lojas em que o Usuário mexe em Pedidos; `null` = todas. Sem a Permission e sem Vínculo, nenhuma (fail-closed). */
export async function lojasDoUsuario({ permissions, vinculos }: Pick<EscopoLojasDeps, "permissions" | "vinculos">, c: AuthContext): Promise<number[] | null> {
  if (permissions.has(c.get("user")?.permissions, INOVAFARMA_PERMISSIONS.ref("pedidos-todas-lojas:gerir").key)) return null;
  const usuarioId = c.get("user")?.sub;
  return (usuarioId ? (await vinculoDoUsuario(vinculos, usuarioId))?.lojas : null) ?? [];
}

async function itensDoCorpo(c: AuthContext): Promise<Parameters<typeof lojasDoPedido>[0]> {
  const corpo = (await c.req.json().catch(() => null)) as { itens?: unknown } | null;
  // Corpo inválido segue para a rota, que o recusa com a própria mensagem.
  return Array.isArray(corpo?.itens) ? corpo.itens.filter((i): i is Parameters<typeof lojasDoPedido>[0][number] => Array.isArray((i as { quantidades?: unknown } | null)?.quantidades)) : [];
}

/**
 * Autenticação das rotas de Pedido com o recorte por Loja: consultar é livre; gerar e alterar exige todas as Lojas de
 * destino do Pedido (as que ele tem e as que passa a ter).
 */
export function authDoPedido(deps: EscopoLojasDeps): MiddlewareHandler {
  return (c, next) =>
    deps.auth(c, async () => {
      if (c.req.method === "GET" || c.req.path.endsWith("/filtrar-produtos")) return next();
      const contexto = c as AuthContext;
      const permitidas = await lojasDoUsuario(deps, contexto);
      if (permitidas === null) return next();
      const id = c.req.param("id");
      const atual = id ? await deps.pedidos.pedido(id) : null;
      const lojas = [...lojasDoPedido(atual?.itens ?? []), ...lojasDoPedido(await itensDoCorpo(contexto))];
      if (lojas.some((l) => !permitidas.includes(l))) {
        c.res = c.json({ error: FORA_DO_ESCOPO }, 403);
        return;
      }
      return next();
    });
}
