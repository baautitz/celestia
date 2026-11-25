import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { BUSCA_LISTA_SQL, conferirSql, type ResultadoBusca } from "./lista-produtos.js";
import { ERP_INDISPONIVEL, recusaDeValidacao, SEM_CONEXAO, type AuthContext, type ErpQuery } from "./metas-comum.js";
import { parametrosBusca } from "./produtos-erp.js";
import { EntradaLista, idValido, MIN_BUSCA_LISTA, TIPOS_ENTRADA } from "./tipos-meta.js";

const ID_INVALIDO = "Uma entrada da Lista tem um identificador inválido.";
const Conferencia = z.object({ entradas: z.array(EntradaLista.pick({ tipo: true, id: true }).refine(idValido, ID_INVALIDO)).max(500) });
const TipoBusca = z.enum(TIPOS_ENTRADA, { error: "Tipo de entrada da Lista inválido." });

export interface BuscaDaListaDeps {
  routes: ModuleContext["routes"];
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  /** Raiz das rotas (`<base>/busca` e `<base>/conferir`). */
  base: string;
  /** A resposta 403 de quem não pode montar a Lista; null libera. */
  recusa: (c: AuthContext) => Response | null;
}

/** Busca e conferência das entradas da Lista de Produtos no ERP, cada tela com a própria Permission. */
export function registrarBuscaDaLista({ routes, auth, erpClient, base, recusa }: BuscaDaListaDeps): void {
  // Busca de entradas da Lista de Produtos no ERP, só no tipo escolhido.
  routes.get(`${base}/busca`, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const parsedTipo = TipoBusca.safeParse(c.req.query("tipo"));
    if (!parsedTipo.success) return recusaDeValidacao(c, parsedTipo.error);
    const tipo = parsedTipo.data;
    const q = (c.req.query("q") ?? "").trim().slice(0, 100);
    if (q.length < MIN_BUSCA_LISTA[tipo]) return c.json([]);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const rows = await client.query<ResultadoBusca>(BUSCA_LISTA_SQL[tipo], parametrosBusca(q));
      return c.json(rows.map((r) => ({ tipo, id: String(r.id), nome: (r.nome || "").trim(), detalhe: r.detalhe ?? null })));
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
  });

  // Quais entradas da Lista ainda existem no ERP: as outras aparecem com o aviso "não encontrado no ERP".
  routes.post(`${base}/conferir`, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const parsed = Conferencia.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return recusaDeValidacao(c, parsed.error);
    const consulta = conferirSql(parsed.data.entradas);
    if (!consulta) return c.json({ ausentes: [] });
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const existem = new Set((await client.query<{ tipo: string; id: string | number }>(consulta.sql, consulta.params)).map((r) => `${r.tipo}:${String(r.id).toUpperCase()}`));
      return c.json({ ausentes: parsed.data.entradas.filter((e) => !existem.has(`${e.tipo}:${e.id.toUpperCase()}`)) });
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
  });
}
