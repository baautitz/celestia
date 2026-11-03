import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { baixasDoPeriodo, type BaixaDoPeriodo, type PeriodoDasBaixas } from "./baixas-do-periodo.js";
import { ERP_INDISPONIVEL, LOJA_FORA_DO_VINCULO, SEM_CONEXAO, SEM_VINCULO, lojasDoVinculo } from "./estoque-pre-vencidos-routes.js";
import type { BaixasCongeladasStore } from "./baixas-congeladas-store.js";
import { CORRECAO_BAIXA_ACTIONS, CORRECAO_BAIXA_PLUGIN, CORRECAO_BAIXA_TARGET, type AtributosCorrecaoBaixa } from "./correcoes-baixa-audit.js";
import { CorrecaoDuplicadaError, type CorrecaoBaixa, type CorrecaoBaixaStore } from "./correcoes-baixa-store.js";
import type { AuditService } from "./vinculo-audit.js";
import type { EstoquePreVencidoStore } from "./estoque-pre-vencidos-store.js";
import type { VinculoStore } from "./vinculo-store.js";

interface ErpQuery {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
}

/** Forma do serviço `periods` do Module `closing_period`; o Plugin não importa `@platform/server` (ADR 0002). */
interface PeriodsService {
  list(): Promise<PeriodoDasBaixas[]>;
}

export interface BaixasPreVencidosRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  store: EstoquePreVencidoStore;
  congeladas: BaixasCongeladasStore;
  correcoes: CorrecaoBaixaStore;
  vinculos: VinculoStore;
  periods: PeriodsService;
  audit: AuditService;
}

type AuthContext = Context<{ Variables: { user?: { sub?: string; fullname?: string; permissions?: string[] } } }>;

/** Uma Baixa na aba Baixas: a venda, o produto e quanto dela foi Pré-vencido. Nunca o código do produto no ERP. */
export interface BaixaPublica {
  vendaId: number;
  data: string;
  produtoId: string;
  nomeProduto: string;
  codigoBarra: string | null;
  quantidadeVendida: number;
  quantidade: number;
  /** Correção de Baixa desta venda: a `quantidade` acima já a reflete. */
  correcao?: BaixaDoPeriodo["correcao"];
}

export interface BaixasDoColaborador {
  codigoColaborador: number;
  nomeColaborador: string;
  quantidade: number;
  vendas: BaixaPublica[];
}

const SO_PERIODO_ABERTO = "Só se corrige Baixa no Período aberto.";
const CORRECAO_EXISTENTE = { error: "A venda já tem Correção de Baixa: altere a que existe.", code: "correcao_existente" };
const CORRECAO_DESATUALIZADA = { error: "A Correção de Baixa foi alterada por outra pessoa. A lista foi recarregada.", code: "versao_desatualizada" };
const Motivo = z.string({ invalid_type_error: "Informe o motivo." }).trim().min(1, "Informe o motivo da Correção.").max(500, "O motivo tem no máximo 500 caracteres.");
const QuantidadeCorrigida = z.number({ invalid_type_error: "Informe a quantidade." }).int("Informe uma quantidade inteira.").min(0, "A quantidade corrigida não pode ser negativa.");
const NovaCorrecao = z.object({
  codigoLoja: z.number().int().min(1),
  periodoId: z.string().min(1),
  vendaId: z.number().int(),
  produtoId: z.string().min(1),
  quantidade: QuantidadeCorrigida,
  motivo: Motivo,
});
const EdicaoCorrecao = z.object({ quantidade: QuantidadeCorrigida, motivo: Motivo, version: z.number().int().min(1) });

/** Agrupa as Baixas por Colaborador (pelo nome), cada um com as suas vendas na ordem da data. */
export function porColaborador(baixas: readonly BaixaDoPeriodo[]): BaixasDoColaborador[] {
  const grupos = new Map<number, BaixasDoColaborador>();
  for (const { venda, quantidade, nomeProduto, codigoBarra, correcao } of baixas) {
    const grupo = grupos.get(venda.codigoColaborador) ?? { codigoColaborador: venda.codigoColaborador, nomeColaborador: venda.nomeColaborador, quantidade: 0, vendas: [] };
    grupo.quantidade += quantidade;
    grupo.vendas.push({ vendaId: venda.vendaId, data: venda.data, produtoId: venda.produtoId, nomeProduto, codigoBarra, quantidadeVendida: venda.quantidade, quantidade, ...(correcao ? { correcao } : {}) });
    grupos.set(venda.codigoColaborador, grupo);
  }
  return [...grupos.values()].sort((a, b) => a.nomeColaborador.localeCompare(b.nomeColaborador, "pt-BR") || a.codigoColaborador - b.codigoColaborador);
}

/** Aba Baixas: as Baixas de Pré-vencido de uma Loja do Vínculo num Closing Period. */
export function registerBaixasPreVencidosRoutes({ routes, permissions, auth, erpClient, store, congeladas, correcoes, vinculos, periods, audit }: BaixasPreVencidosRoutesDeps): void {
  const gerir = INOVAFARMA_PERMISSIONS.ref("pre-vencidos-baixas:manage");
  const deps = { erpClient, store, congeladas, correcoes };

  /** Recusa quem não tem a Permission, não tem Vínculo ou não tem a Loja no Vínculo. */
  const recusaLoja = async (c: AuthContext, codigoLoja: number) => {
    if (!permissions.has(c.get("user")?.permissions, gerir.key)) return c.json({ error: gerir.deniedMessage }, 403);
    const lojas = await lojasDoVinculo(vinculos, c.get("user")?.sub);
    if (!lojas) return c.json({ error: SEM_VINCULO }, 403);
    if (!lojas.includes(codigoLoja)) return c.json({ error: LOJA_FORA_DO_VINCULO }, 403);
    return null;
  };

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
      return c.json(porColaborador(await baixasDoPeriodo(deps, periodo, [codigoLoja])));
    } catch (err: unknown) {
      return c.json({ error: err instanceof Error && err.message === SEM_CONEXAO ? SEM_CONEXAO : ERP_INDISPONIVEL }, 503);
    }
  });

  /** A Baixa da venda (venda + produto) na Loja e no Período aberto; senão, a resposta de recusa. */
  const linhaNoPeriodoAberto = async (c: AuthContext, codigoLoja: number, periodoId: string, vendaId: number, produtoId: string) => {
    const periodo = (await periods.list()).find((p) => p.id === periodoId);
    if (!periodo) return { recusa: c.json({ error: "Período de Fechamento não encontrado." }, 404) } as const;
    if (periodo.status === "closed") return { recusa: c.json({ error: SO_PERIODO_ABERTO }, 409) } as const;
    let baixas: BaixaDoPeriodo[];
    try {
      baixas = await baixasDoPeriodo(deps, periodo, [codigoLoja]);
    } catch (err: unknown) {
      return { recusa: c.json({ error: err instanceof Error && err.message === SEM_CONEXAO ? SEM_CONEXAO : ERP_INDISPONIVEL }, 503) } as const;
    }
    const linha = baixas.find((b) => b.venda.vendaId === vendaId && b.venda.produtoId === produtoId);
    if (!linha) return { recusa: c.json({ error: "Venda não encontrada nas Baixas da Loja no Período." }, 404) } as const;
    return { linha } as const;
  };

  const registrar = (c: AuthContext, action: string, correcao: Pick<CorrecaoBaixa, "id" | "codigoLoja" | "motivo">, linha: BaixaDoPeriodo, antes: number, depois: number | null) => {
    const user = c.get("user");
    const attributes: AtributosCorrecaoBaixa = {
      codigoLoja: correcao.codigoLoja,
      vendaId: linha.venda.vendaId,
      nomeProduto: linha.nomeProduto,
      nomeColaborador: linha.venda.nomeColaborador,
      quantidadeVendida: linha.venda.quantidade,
      antes,
      depois,
      motivo: correcao.motivo,
    };
    return audit.record({ plugin: CORRECAO_BAIXA_PLUGIN, action, actor: { id: user?.sub ?? "", name: user?.fullname ?? "" }, target: { type: CORRECAO_BAIXA_TARGET, id: correcao.id }, attributes });
  };

  /** A quantidade corrigida vai de zero até o que a venda teve. */
  const foraDaVenda = (c: AuthContext, quantidade: number, linha: BaixaDoPeriodo) =>
    quantidade > linha.venda.quantidade ? c.json({ error: `A quantidade corrigida vai de 0 até o que a venda teve (${linha.venda.quantidade}).` }, 400) : null;

  routes.post("/pre-vencidos/baixas/correcoes", auth, async (c: AuthContext) => {
    if (!permissions.has(c.get("user")?.permissions, gerir.key)) return c.json({ error: gerir.deniedMessage }, 403);
    const parsed = NovaCorrecao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const { codigoLoja, periodoId, vendaId, produtoId, quantidade, motivo } = parsed.data;
    const recusa = await recusaLoja(c, codigoLoja);
    if (recusa) return recusa;
    const alvo = await linhaNoPeriodoAberto(c, codigoLoja, periodoId, vendaId, produtoId);
    if ("recusa" in alvo) return alvo.recusa;
    if (alvo.linha.correcao) return c.json(CORRECAO_EXISTENTE, 409);
    const fora = foraDaVenda(c, quantidade, alvo.linha);
    if (fora) return fora;
    const user = c.get("user");
    let criada: CorrecaoBaixa;
    try {
      criada = await correcoes.criar({ periodoId, codigoLoja, vendaId, produtoId, quantidade, motivo, autorId: user?.sub ?? "", autorNome: user?.fullname ?? "" });
    } catch (err) {
      if (err instanceof CorrecaoDuplicadaError) return c.json(CORRECAO_EXISTENTE, 409);
      throw err;
    }
    await registrar(c, CORRECAO_BAIXA_ACTIONS.criar, criada, alvo.linha, alvo.linha.quantidade, quantidade);
    return c.json(criada, 201);
  });

  /** Correção de uma Loja do Vínculo, com a Baixa dela no Período aberto; senão a resposta de recusa. */
  const correcaoDaLoja = async (c: AuthContext) => {
    if (!permissions.has(c.get("user")?.permissions, gerir.key)) return { recusa: c.json({ error: gerir.deniedMessage }, 403) } as const;
    const correcao = await correcoes.get(c.req.param("id") ?? "");
    if (!correcao) return { recusa: c.json({ error: "Correção de Baixa não encontrada." }, 404) } as const;
    const recusa = await recusaLoja(c, correcao.codigoLoja);
    if (recusa) return { recusa } as const;
    const alvo = await linhaNoPeriodoAberto(c, correcao.codigoLoja, correcao.periodoId, correcao.vendaId, correcao.produtoId);
    if ("recusa" in alvo) return { recusa: alvo.recusa } as const;
    return { correcao, linha: alvo.linha } as const;
  };

  routes.put("/pre-vencidos/baixas/correcoes/:id", auth, async (c: AuthContext) => {
    const alvo = await correcaoDaLoja(c);
    if ("recusa" in alvo) return alvo.recusa;
    const parsed = EdicaoCorrecao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const { quantidade, motivo, version } = parsed.data;
    const fora = foraDaVenda(c, quantidade, alvo.linha);
    if (fora) return fora;
    const user = c.get("user");
    const atualizada = await correcoes.atualizar(alvo.correcao.id, { quantidade, motivo, autorId: user?.sub ?? "", autorNome: user?.fullname ?? "" }, version);
    if (!atualizada) return c.json(CORRECAO_DESATUALIZADA, 409);
    await registrar(c, CORRECAO_BAIXA_ACTIONS.editar, atualizada, alvo.linha, alvo.correcao.quantidade, quantidade);
    return c.json(atualizada);
  });

  routes.delete("/pre-vencidos/baixas/correcoes/:id", auth, async (c: AuthContext) => {
    const alvo = await correcaoDaLoja(c);
    if ("recusa" in alvo) return alvo.recusa;
    const version = Number(c.req.query("version"));
    if (!Number.isInteger(version) || version < 1) return c.json({ error: "Parâmetro 'version' é obrigatório." }, 400);
    if (!(await correcoes.excluir(alvo.correcao.id, version))) return c.json(CORRECAO_DESATUALIZADA, 409);
    await registrar(c, CORRECAO_BAIXA_ACTIONS.excluir, alvo.correcao, alvo.linha, alvo.correcao.quantidade, null);
    return c.json({ success: true });
  });
}
