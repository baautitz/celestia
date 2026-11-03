import type { Context, MiddlewareHandler } from "hono";
import type { ModuleContext } from "@platform/core/module";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { buscaProdutosSql, MIN_BUSCA_PRODUTO, parametrosBusca } from "./produtos-erp.js";
import { ERP_INDISPONIVEL, SEM_CONEXAO, type ErpQuery } from "./metas-comum.js";
import { inclusaoRetroativa, lojasDoErp, lojasDoVinculo } from "./pre-vencidos-comum.js";
import type { VinculoStore } from "./vinculo-store.js";

/** Forma do serviço `periods` do Module `closing_period`; o Plugin não importa `@platform/server` (ADR 0002). */
export interface PeriodoResumo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "open" | "closed";
}
export interface PeriodsService {
  list(): Promise<PeriodoResumo[]>;
}

export interface PreVencidosRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  vinculos: VinculoStore;
  periods: PeriodsService;
}

type AuthContext = Context<{ Variables: { user?: { sub?: string; permissions?: string[] } } }>;

export type LinhaBusca = { produtoId: string; nome: string | null; codigoBarra: string | null };

/** O que a tela Pré-vencidos precisa para abrir e a busca de produto do Estoque. */
export function registerPreVencidosRoutes({ routes, permissions, auth, erpClient, vinculos, periods }: PreVencidosRoutesDeps): void {
  const estoque = INOVAFARMA_PERMISSIONS.ref("pre-vencidos-estoque:manage");
  const baixas = INOVAFARMA_PERMISSIONS.ref("pre-vencidos-baixas:manage");
  const pode = (c: AuthContext, ref: { key: string }) => permissions.has(c.get("user")?.permissions, ref.key);

  // O que a tela precisa para abrir: Closing Periods, as Lojas do Vínculo, as abas que a Permission libera e, para quem
  // gere as Baixas, até onde a inclusão de um Item pode retroagir (calculado aqui, na hora do ERP).
  routes.get("/pre-vencidos/contexto", auth, async (c: AuthContext) => {
    const podeEstoque = pode(c, estoque);
    const podeBaixas = pode(c, baixas);
    if (!podeEstoque && !podeBaixas) return c.json({ error: estoque.deniedMessage }, 403);

    const lojasErp = await lojasDoErp(erpClient());
    const lojas = ((await lojasDoVinculo(vinculos, c.get("user")?.sub)) ?? []).map((codigo) => ({ codigo, nome: lojasErp.find((l) => l.codigo === codigo)?.nome ?? "" }));
    return c.json({
      podeEstoque,
      podeBaixas,
      periodos: (await periods.list()).sort((a, b) => b.startDate.localeCompare(a.startDate)),
      lojas,
      ...(podeBaixas ? { inclusaoRetroativa: (await inclusaoRetroativa(periods)) ?? undefined } : {}),
    });
  });

  routes.get("/pre-vencidos/produtos", auth, async (c: AuthContext) => {
    if (!pode(c, estoque)) return c.json({ error: estoque.deniedMessage }, 403);
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < MIN_BUSCA_PRODUTO) return c.json([]);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const rows = await client.query<LinhaBusca>(buscaProdutosSql({ somenteAtivos: false }), parametrosBusca(q));
      return c.json(rows.map((r) => ({ id: r.produtoId, nome: (r.nome || "").trim(), codigoBarra: r.codigoBarra })));
    } catch {
      return c.json({ error: ERP_INDISPONIVEL }, 503);
    }
  });
}
