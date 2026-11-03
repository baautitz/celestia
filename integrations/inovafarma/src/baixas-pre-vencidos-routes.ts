import type { Context, MiddlewareHandler } from "hono";
import type { ModuleContext } from "@platform/core/module";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import type { VendaDaLoja } from "./baixas-da-loja.js";
import { BaixasSemErpError, type BaixasPreVencidos, type PeriodoDasBaixas } from "./baixas-do-periodo.js";
import type { BaixaDeVenda } from "./baixas-pre-vencidos.js";
import { ERP_INDISPONIVEL, LOJA_FORA_DO_VINCULO, SEM_CONEXAO, SEM_VINCULO, lojasDoVinculo } from "./estoque-pre-vencidos-routes.js";
import type { VinculoStore } from "./vinculo-store.js";

/** Forma do serviço `periods` do Module `closing_period`; o Plugin não importa `@platform/server` (ADR 0002). */
interface PeriodsService {
  list(): Promise<PeriodoDasBaixas[]>;
}

export interface BaixasPreVencidosRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  baixas: BaixasPreVencidos;
  vinculos: VinculoStore;
  periods: PeriodsService;
}

type AuthContext = Context<{ Variables: { user?: { sub?: string; permissions?: string[] } } }>;

/** Uma Baixa na aba Baixas: a venda, o produto e quanto dela foi Pré-vencido. Nunca o código do produto no ERP. */
export interface BaixaPublica {
  vendaId: number;
  data: string;
  produtoId: string;
  nomeProduto: string;
  codigoBarra: string | null;
  quantidadeVendida: number;
  quantidade: number;
}

export interface BaixasDoColaborador {
  codigoColaborador: number;
  nomeColaborador: string;
  quantidade: number;
  vendas: BaixaPublica[];
}

/** Agrupa as Baixas por Colaborador (pelo nome), cada um com as suas vendas na ordem da data. */
export function porColaborador(baixas: readonly BaixaDeVenda<VendaDaLoja>[]): BaixasDoColaborador[] {
  const grupos = new Map<number, BaixasDoColaborador>();
  for (const { venda, quantidade } of baixas) {
    const grupo = grupos.get(venda.codigoColaborador) ?? { codigoColaborador: venda.codigoColaborador, nomeColaborador: venda.nomeColaborador, quantidade: 0, vendas: [] };
    grupo.quantidade += quantidade;
    grupo.vendas.push({ vendaId: venda.vendaId, data: venda.data, produtoId: venda.produtoId, nomeProduto: venda.nomeProduto, codigoBarra: venda.codigoBarra, quantidadeVendida: venda.quantidade, quantidade });
    grupos.set(venda.codigoColaborador, grupo);
  }
  return [...grupos.values()].sort((a, b) => a.nomeColaborador.localeCompare(b.nomeColaborador, "pt-BR") || a.codigoColaborador - b.codigoColaborador);
}

/** Aba Baixas: as Baixas de Pré-vencido de uma Loja do Vínculo num Closing Period. */
export function registerBaixasPreVencidosRoutes({ routes, permissions, auth, baixas, vinculos, periods }: BaixasPreVencidosRoutesDeps): void {
  const gerir = INOVAFARMA_PERMISSIONS.ref("pre-vencidos-baixas:manage");

  routes.get("/pre-vencidos/baixas", auth, async (c: AuthContext) => {
    if (!permissions.has(c.get("user")?.permissions, gerir.key)) return c.json({ error: gerir.deniedMessage }, 403);
    const codigoLoja = Number(c.req.query("codigoLoja"));
    const periodoId = c.req.query("periodoId");
    if (!Number.isInteger(codigoLoja) || codigoLoja < 1 || !periodoId) return c.json({ error: "Parâmetros 'codigoLoja' e 'periodoId' são obrigatórios." }, 400);
    const lojas = await lojasDoVinculo(vinculos, c.get("user")?.sub);
    if (!lojas) return c.json({ error: SEM_VINCULO }, 403);
    if (!lojas.includes(codigoLoja)) return c.json({ error: LOJA_FORA_DO_VINCULO }, 403);
    const periodo = (await periods.list()).find((p) => p.id === periodoId);
    if (!periodo) return c.json({ error: "Período de Fechamento não encontrado." }, 404);

    try {
      return c.json(porColaborador(await baixas.baixasDoPeriodo(periodo, [codigoLoja])));
    } catch (err) {
      if (err instanceof BaixasSemErpError) return c.json({ error: err.semConexao ? SEM_CONEXAO : ERP_INDISPONIVEL }, 503);
      throw err;
    }
  });
}
