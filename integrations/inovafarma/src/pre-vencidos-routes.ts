import type { Context, MiddlewareHandler } from "hono";
import type { ModuleContext } from "@platform/core/module";
import { LOJAS_SQL } from "./colaboradores-routes.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { buscaProdutosSql, MIN_BUSCA_PRODUTO, parametrosBusca } from "./produtos-erp.js";
import { lojasDoVinculo } from "./estoque-pre-vencidos-routes.js";
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

interface ErpQuery {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
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

const SEM_CONEXAO = "Conexão com ERP InovaFarma não configurada ou inativa.";
const ERP_INDISPONIVEL = "ERP InovaFarma indisponível. Tente novamente em instantes.";

export type LinhaBusca = { produtoId: string; nome: string | null; codigoBarra: string | null };

/** O que a tela Pré-vencidos precisa para abrir e a busca de produto do Estoque. */
export function registerPreVencidosRoutes({ routes, permissions, auth, erpClient, vinculos, periods }: PreVencidosRoutesDeps): void {
  const estoque = INOVAFARMA_PERMISSIONS.ref("pre-vencidos-estoque:manage");
  const baixas = INOVAFARMA_PERMISSIONS.ref("pre-vencidos-baixas:manage");
  const pode = (c: AuthContext, ref: { key: string }) => permissions.has(c.get("user")?.permissions, ref.key);

  const lojasDoErp = async (client: ErpQuery | undefined) => {
    if (!client) return [];
    try {
      const rows = await client.query<{ codigoEmpresa: number; nome: string | null }>(LOJAS_SQL);
      return rows.map((r) => ({ codigo: Number(r.codigoEmpresa), nome: (r.nome || "").trim() }));
    } catch {
      return [];
    }
  };

  // O que a tela precisa para abrir: Closing Periods, Lojas e as abas que a Permission libera.
  routes.get("/pre-vencidos/contexto", auth, async (c: AuthContext) => {
    const podeEstoque = pode(c, estoque);
    const podeBaixas = pode(c, baixas);
    if (!podeEstoque && !podeBaixas) return c.json({ error: estoque.deniedMessage }, 403);

    const lojasErp = await lojasDoErp(erpClient());
    // Estoque e Baixas: só as Lojas do Vínculo.
    const lojas = ((await lojasDoVinculo(vinculos, c.get("user")?.sub)) ?? []).map((codigo) => ({ codigo, nome: lojasErp.find((l) => l.codigo === codigo)?.nome ?? "" }));
    return c.json({
      podeEstoque,
      podeBaixas,
      periodos: (await periods.list()).sort((a, b) => b.startDate.localeCompare(a.startDate)),
      ...(podeEstoque ? { lojasEstoque: lojas } : {}),
      ...(podeBaixas ? { lojasBaixas: lojas } : {}),
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
