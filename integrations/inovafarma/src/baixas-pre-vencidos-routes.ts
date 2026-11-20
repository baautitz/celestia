import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { baixaPublica, baixasDoPeriodo, tetoDaCorrecao, type BaixaDoPeriodo, type BaixaPublica, type BaixasDoPeriodoDeps } from "./baixas-do-periodo.js";
import { ator, Codigo, CodigoEmTexto, erroDoErp, PERIODO_NAO_ENCONTRADO, periodoAindaAberto, recusaDeValidacao, Version, versaoDaQuery, versaoDesatualizada, type AuthContext } from "./metas-comum.js";
import { LOJA_FORA_DO_VINCULO, recusaDeLoja, visualizacoesDasBaixas } from "./pre-vencidos-comum.js";
import { VISUALIZACAO_PERMISSION_BAIXAS, visualizacaoPedida } from "./visualizacoes.js";
import type { PeriodsService } from "./pre-vencidos-routes.js";
import { CORRECAO_BAIXA_ACTIONS, CORRECAO_BAIXA_PLUGIN, CORRECAO_BAIXA_TARGET, type AtributosCorrecaoBaixa } from "./correcoes-baixa-audit.js";
import { CorrecaoDuplicadaError, type CorrecaoBaixa } from "./correcoes-baixa-store.js";
import type { AuditService } from "./vinculo-audit.js";
import type { VinculoStore } from "./vinculo-store.js";

export interface BaixasPreVencidosRoutesDeps extends BaixasDoPeriodoDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  vinculos: VinculoStore;
  periods: PeriodsService;
  audit: AuditService;
}

export interface BaixasDoColaborador {
  codigoColaborador: number;
  nomeColaborador: string;
  quantidade: number;
  /** Cada venda com a Loja onde foi feita: a Correção só vale nas Lojas do Vínculo. */
  vendas: (BaixaPublica & { codigoLoja: number })[];
}

const SO_PERIODO_ABERTO = "Só se corrige Baixa no Período aberto.";
const CORRECAO_EXISTENTE = { error: "A venda já tem Correção de Baixa: altere a que existe.", code: "correcao_existente" };
const CORRECAO_DESATUALIZADA = versaoDesatualizada("A Correção de Baixa foi alterada por outra pessoa. A lista foi recarregada.");
const Motivo = z.string({ error: "Informe o motivo." }).trim().min(1, "Informe o motivo da Correção.").max(500, "O motivo tem no máximo 500 caracteres.");
const QuantidadeCorrigida = z.number({ error: "Informe a quantidade." }).int("Informe uma quantidade inteira.").min(0, "A quantidade corrigida não pode ser negativa.");
const NovaCorrecao = z.object({
  codigoLoja: Codigo,
  periodoId: z.string().min(1),
  vendaId: z.number().int(),
  produtoId: z.string().min(1),
  quantidade: QuantidadeCorrigida,
  motivo: Motivo,
});
const EdicaoCorrecao = z.object({ quantidade: QuantidadeCorrigida, motivo: Motivo, version: Version });
const FiltroBaixas = z.object({
  periodoId: z.string({ error: "Parâmetro 'periodoId' é obrigatório." }).min(1, "Parâmetro 'periodoId' é obrigatório."),
  codigoLoja: CodigoEmTexto.optional(),
});

/** Agrupa as Baixas por Colaborador (pelo nome), cada um com as suas vendas na ordem da data. */
export function porColaborador(baixas: readonly BaixaDoPeriodo[]): BaixasDoColaborador[] {
  const grupos = new Map<number, BaixasDoColaborador>();
  for (const baixa of baixas) {
    const { venda, quantidade } = baixa;
    const grupo = grupos.get(venda.codigoColaborador) ?? { codigoColaborador: venda.codigoColaborador, nomeColaborador: venda.nomeColaborador, quantidade: 0, vendas: [] };
    grupo.quantidade += quantidade;
    grupo.vendas.push({ ...baixaPublica(baixa), codigoLoja: baixa.codigoLoja });
    grupos.set(venda.codigoColaborador, grupo);
  }
  return [...grupos.values()].sort((a, b) => a.nomeColaborador.localeCompare(b.nomeColaborador, "pt-BR") || a.codigoColaborador - b.codigoColaborador);
}

/** Aba Baixas: as Baixas de Pré-vencido de um Closing Period por Visualização e as Correções de Baixa nas Lojas do Vínculo. */
export function registerBaixasPreVencidosRoutes({ routes, permissions, auth, vinculos, periods, audit, ...deps }: BaixasPreVencidosRoutesDeps): void {
  const { correcoes } = deps;
  const gerir = INOVAFARMA_PERMISSIONS.ref("pre-vencidos-baixas:manage");
  const recusaLoja = recusaDeLoja(permissions, vinculos, gerir);

  /**
   * Baixas do Período na Visualização pedida (a mais ampla, sem ela), com as regras do Desempenho de Vendas: Geral, todas
   * as Lojas; Loja, as Lojas do Vínculo; Individual, as vendas do Colaborador vinculado em qualquer Loja. `codigoLoja`
   * opcional filtra uma Loja (não em Individual).
   */
  routes.get("/pre-vencidos/baixas", auth, async (c: AuthContext) => {
    const { disponiveis, lojas: lojasVinculo, codigoColaborador } = await visualizacoesDasBaixas(c, permissions, vinculos);
    const pedida = visualizacaoPedida(c, disponiveis, VISUALIZACAO_PERMISSION_BAIXAS);
    if ("recusa" in pedida) return pedida.recusa;
    const { visualizacao } = pedida;
    const consulta = FiltroBaixas.safeParse({ periodoId: c.req.query("periodoId"), codigoLoja: c.req.query("codigoLoja") || undefined });
    if (!consulta.success) return recusaDeValidacao(c, consulta.error);
    const { periodoId, codigoLoja } = consulta.data;
    if (visualizacao === "loja" && codigoLoja !== undefined && !lojasVinculo.includes(codigoLoja)) return c.json({ error: LOJA_FORA_DO_VINCULO }, 403);
    const periodo = (await periods.list()).find((p) => p.id === periodoId);
    if (!periodo) return c.json({ error: PERIODO_NAO_ENCONTRADO }, 404);

    const lojas = visualizacao === "individual" ? undefined : codigoLoja !== undefined ? [codigoLoja] : visualizacao === "loja" ? lojasVinculo : undefined;
    try {
      const baixas = await baixasDoPeriodo(deps, periodo, lojas);
      return c.json(porColaborador(visualizacao === "individual" ? baixas.filter((b) => b.venda.codigoColaborador === codigoColaborador) : baixas));
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });

  /** A Baixa da venda (venda + produto) na Loja e no Período aberto; senão, a resposta de recusa. */
  const linhaNoPeriodoAberto = async (c: AuthContext, codigoLoja: number, periodoId: string, vendaId: number, produtoId: string) => {
    const periodo = (await periods.list()).find((p) => p.id === periodoId);
    if (!periodo) return { recusa: c.json({ error: PERIODO_NAO_ENCONTRADO }, 404) } as const;
    if (periodo.status === "closed") return { recusa: c.json({ error: SO_PERIODO_ABERTO }, 409) } as const;
    let linha: BaixaDoPeriodo | undefined;
    let teto: number;
    try {
      linha = (await baixasDoPeriodo(deps, periodo, [codigoLoja])).find((b) => b.venda.vendaId === vendaId && b.venda.produtoId === produtoId);
      if (!linha) return { recusa: c.json({ error: "Venda não encontrada nas Baixas da Loja no Período." }, 404) } as const;
      teto = linha.correcao ? await tetoDaCorrecao(deps, periodo, codigoLoja, linha.venda) : linha.quantidade;
    } catch (err: unknown) {
      return { recusa: c.json(erroDoErp(err), 503) } as const;
    }
    return { linha, teto } as const;
  };

  const registrar = (c: AuthContext, action: string, id: string, linha: BaixaDoPeriodo, antes: AtributosCorrecaoBaixa["antes"], depois: AtributosCorrecaoBaixa["depois"]) => {
    const attributes: AtributosCorrecaoBaixa = {
      codigoLoja: linha.codigoLoja,
      vendaId: linha.venda.vendaId,
      nomeProduto: linha.nomeProduto,
      nomeColaborador: linha.venda.nomeColaborador,
      quantidadeVendida: linha.venda.quantidade,
      antes,
      depois,
    };
    return audit.record({ plugin: CORRECAO_BAIXA_PLUGIN, action, actor: ator(c), target: { type: CORRECAO_BAIXA_TARGET, id }, attributes });
  };

  /**
   * A quantidade corrigida vai de zero até o teto: o que a venda teve, limitado ao que havia no Estoque para ela. Acima
   * disso a Correção gravaria mais do que a venda baixa de fato.
   */
  const foraDoTeto = (c: AuthContext, quantidade: number, teto: number) =>
    quantidade > teto ? c.json({ error: `A quantidade corrigida vai de 0 até o que a venda teve e havia no Estoque para ela (${teto}).` }, 400) : null;

  routes.post("/pre-vencidos/baixas/correcoes", auth, async (c: AuthContext) => {
    if (!permissions.has(c.get("user")?.permissions, gerir.key)) return c.json({ error: gerir.deniedMessage }, 403);
    const parsed = NovaCorrecao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return recusaDeValidacao(c, parsed.error);
    const { codigoLoja, periodoId, vendaId, produtoId, quantidade, motivo } = parsed.data;
    const recusa = await recusaLoja(c, codigoLoja);
    if (recusa) return recusa;
    const alvo = await linhaNoPeriodoAberto(c, codigoLoja, periodoId, vendaId, produtoId);
    if ("recusa" in alvo) return alvo.recusa;
    if (alvo.linha.correcao) return c.json(CORRECAO_EXISTENTE, 409);
    const fora = foraDoTeto(c, quantidade, alvo.teto);
    if (fora) return fora;
    // O Período pode ter fechado durante a consulta ao ERP: confere de novo logo antes de gravar.
    if (!(await periodoAindaAberto(periods, periodoId))) return c.json({ error: SO_PERIODO_ABERTO }, 409);
    const user = c.get("user");
    let criada: CorrecaoBaixa;
    try {
      criada = await correcoes.criar({ periodoId, codigoLoja, vendaId, produtoId, quantidade, motivo, autorId: user?.sub ?? "", autorNome: user?.fullname ?? "" });
    } catch (err) {
      if (err instanceof CorrecaoDuplicadaError) return c.json(CORRECAO_EXISTENTE, 409);
      throw err;
    }
    await registrar(c, CORRECAO_BAIXA_ACTIONS.criar, criada.id, alvo.linha, { quantidade: alvo.linha.quantidade }, { quantidade, motivo });
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
    return { correcao, linha: alvo.linha, teto: alvo.teto } as const;
  };

  routes.put("/pre-vencidos/baixas/correcoes/:id", auth, async (c: AuthContext) => {
    const alvo = await correcaoDaLoja(c);
    if ("recusa" in alvo) return alvo.recusa;
    const parsed = EdicaoCorrecao.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return recusaDeValidacao(c, parsed.error);
    const { quantidade, motivo, version } = parsed.data;
    const fora = foraDoTeto(c, quantidade, alvo.teto);
    if (fora) return fora;
    if (!(await periodoAindaAberto(periods, alvo.correcao.periodoId))) return c.json({ error: SO_PERIODO_ABERTO }, 409);
    const user = c.get("user");
    const atualizada = await correcoes.atualizar(alvo.correcao.id, { quantidade, motivo, autorId: user?.sub ?? "", autorNome: user?.fullname ?? "" }, version);
    if (!atualizada) return c.json(CORRECAO_DESATUALIZADA, 409);
    const antes = { quantidade: alvo.correcao.quantidade, motivo: alvo.correcao.motivo };
    await registrar(c, CORRECAO_BAIXA_ACTIONS.editar, atualizada.id, alvo.linha, antes, { quantidade, motivo });
    return c.json(atualizada);
  });

  routes.delete("/pre-vencidos/baixas/correcoes/:id", auth, async (c: AuthContext) => {
    const alvo = await correcaoDaLoja(c);
    if ("recusa" in alvo) return alvo.recusa;
    const lida = versaoDaQuery(c);
    if ("recusa" in lida) return lida.recusa;
    if (!(await periodoAindaAberto(periods, alvo.correcao.periodoId))) return c.json({ error: SO_PERIODO_ABERTO }, 409);
    if (!(await correcoes.excluir(alvo.correcao.id, lida.version))) return c.json(CORRECAO_DESATUALIZADA, 409);
    await registrar(c, CORRECAO_BAIXA_ACTIONS.excluir, alvo.correcao.id, alvo.linha, { quantidade: alvo.correcao.quantidade, motivo: alvo.correcao.motivo }, null);
    return c.json({ success: true });
  });
}
