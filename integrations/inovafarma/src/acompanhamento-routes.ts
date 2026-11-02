import type { MiddlewareHandler } from "hono";
import type { ModuleContext } from "@platform/core/module";
import { APURACAO_ACTIONS, APURACAO_PLUGIN, APURACAO_TARGET, type AtributosCongelamento } from "./apuracao-audit.js";
import { apurarParticipante, totaisPorColaborador, type DadosColaborador } from "./apuracao.js";
import type { ApuracaoPeriodo, ApuracaoStore, MetaApurada } from "./apuracao-store.js";
import type { AvaliacaoStore } from "./avaliacoes-store.js";
import { desempenhoSql } from "./desempenho-vendas.js";
import type { IndicadorId } from "./indicadores.js";
import { ator, ERP_INDISPONIVEL, PERIODO_NAO_ENCONTRADO, SEM_CONEXAO, vinculoDoUsuario, type AuthContext } from "./metas-comum.js";
import type { MetaStore } from "./metas-store.js";
import { metasDoPeriodo, metasVisiveis } from "./metas-do-periodo.js";
import type { UsersService } from "./colaboradores-routes.js";
import { minhaMeta } from "./minhas-metas.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { conferir } from "./pre-vencidos-conferencia.js";
import { LOTE_PRODUTOS, vendasSql, type LinhaVenda, type PeriodoResumo, type PeriodsService } from "./pre-vencidos-routes.js";
import type { PreVencidoStore } from "./pre-vencidos-store.js";
import { descreverPremio } from "./tipos-meta.js";
import type { TipoMetaStore } from "./tipos-meta-store.js";
import type { ErpQueryClient } from "./server.js";
import { vinculoDesfeito, type VinculoStore } from "./vinculo-store.js";
import type { AuditService } from "./vinculo-audit.js";

export interface AcompanhamentoRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: Pick<ModuleContext["permissions"], "has">;
  auth: MiddlewareHandler;
  events: Pick<ModuleContext["events"], "before" | "after">;
  erpClient: () => ErpQueryClient | undefined;
  tipos: TipoMetaStore;
  metas: MetaStore;
  vinculos: VinculoStore;
  avaliacoes: AvaliacaoStore;
  preVencidos: PreVencidoStore;
  apuracoes: ApuracaoStore;
  periods: PeriodsService;
  audit: AuditService;
  users: UsersService;
}

export type VisualizacaoMetas = "geral" | "loja";

const LOJA_FORA = "A Loja informada não está entre as Lojas do seu Colaborador.";
const FECHAMENTO_SEM_APURACAO = "Não foi possível apurar as Metas do Período no ERP InovaFarma: o Período não pode ser fechado agora. Tente novamente em instantes.";
/** A Apuração ao fechar consulta o ERP inteiro do Período: mais que os 2 s padrão de um handler. */
const TEMPO_APURACAO_MS = 120_000;

/**
 * Visualizações do Acompanhamento que o Usuário tem: Geral pela Permission; Loja pela Permission e pelas
 * Lojas confirmadas no Vínculo dele (sem Loja, não há Visualização Loja).
 */
export async function visualizacoesDasMetas(
  user: { sub?: string; permissions?: string[] } | undefined,
  has: (permissions: readonly string[] | undefined, key: string) => boolean,
  vinculos: VinculoStore,
): Promise<{ geral: boolean; lojas: number[] | null }> {
  const geral = has(user?.permissions, INOVAFARMA_PERMISSIONS.keys["metas-geral:view"]);
  if (!has(user?.permissions, INOVAFARMA_PERMISSIONS.keys["metas-loja:view"]) || !user?.sub) return { geral, lojas: null };
  const vinculo = await vinculoDoUsuario(vinculos, user.sub);
  return { geral, lojas: vinculo?.lojas.length ? vinculo.lojas : null };
}

/**
 * Colaborador de Minhas Metas: o vinculado ao Usuário, se ele tem a Permission. Sem Vínculo, null (fail-closed,
 * como a Visualização Individual de vendas).
 */
export async function colaboradorDasMinhasMetas(
  user: { sub?: string; permissions?: string[] } | undefined,
  has: (permissions: readonly string[] | undefined, key: string) => boolean,
  vinculos: VinculoStore,
): Promise<number | null> {
  if (!has(user?.permissions, INOVAFARMA_PERMISSIONS.keys["metas-individual:view"]) || !user?.sub) return null;
  return (await vinculoDoUsuario(vinculos, user.sub))?.codigoColaborador ?? null;
}

type LinhaDesempenho = { codigoColaborador: number; quantidadeVendas: number | null; totalLiquido: number | null; totalCmv: number | null; vendasComCadastro: number | null } & Record<
  string,
  number | null
>;

const INDICADORES_DE_VENDAS: Partial<Record<IndicadorId, (r: LinhaDesempenho) => number>> = (() => {
  const n = (v: number | null | undefined) => Number(v) || 0;
  const porVenda = (r: LinhaDesempenho, valor: number) => (n(r.quantidadeVendas) > 0 ? valor / n(r.quantidadeVendas) : 0);
  const categoria = (coluna: string) => ({ qtd: (r: LinhaDesempenho) => n(r[`qtd${coluna}`]), valor: (r: LinhaDesempenho) => Math.round(n(r[`valor${coluna}`]) * 100) });
  const [foco, vitaminas, genericos, similares, incentivos] = [categoria("TotalFoco"), categoria("Vitaminas"), categoria("Genericos"), categoria("Similares"), categoria("Incentivos")];
  return {
    cmv: (r) => (n(r.totalLiquido) > 0 ? (n(r.totalCmv) / n(r.totalLiquido)) * 100 : 0),
    "ticket-medio": (r) => Math.round(porVenda(r, n(r.totalLiquido) * 100)),
    "foco-qtd": foco.qtd,
    "foco-valor": foco.valor,
    "vitaminas-qtd": vitaminas.qtd,
    "vitaminas-valor": vitaminas.valor,
    "genericos-qtd": genericos.qtd,
    "genericos-valor": genericos.valor,
    "similares-qtd": similares.qtd,
    "similares-valor": similares.valor,
    "incentivos-qtd": incentivos.qtd,
    "incentivos-valor": incentivos.valor,
    "vendas-cadastro-qtd": (r) => n(r.vendasComCadastro),
    "vendas-cadastro-percent": (r) => porVenda(r, n(r.vendasComCadastro) * 100),
  };
})();

const listaSql = (produtos: number) => `
  SELECT vp.CodigoFuncionario AS codigoColaborador, CONVERT(varchar(36), p.rowguid) AS produtoId, CAST(SUM(vp.Quantidade) AS float) AS quantidade
  FROM Venda v
  JOIN Venda_Produto vp ON vp.CodigoVenda = v.CodigoVenda
  JOIN Produto p ON p.CodigoProduto = vp.CodigoProduto
  WHERE v.Eliminado = 0
    AND v.CodigoAbertura IS NOT NULL
    AND v.DataVenda >= @dataInicio
    AND v.DataVenda <= @dataFim
    AND CONVERT(varchar(36), p.rowguid) IN (${Array.from({ length: produtos }, (_, i) => `@g${i}`).join(", ")})
  GROUP BY vp.CodigoFuncionario, p.rowguid
`;

export function registerAcompanhamentoRoutes(deps: AcompanhamentoRoutesDeps): void {
  const { routes, permissions, auth, events, erpClient, tipos, metas, vinculos, avaliacoes, preVencidos, apuracoes, periods, audit, users } = deps;
  const montagem = metasDoPeriodo({ erpClient, tipos, metas, audit });
  const geralRef = INOVAFARMA_PERMISSIONS.ref("metas-geral:view");
  const lojaRef = INOVAFARMA_PERMISSIONS.ref("metas-loja:view");
  const individualRef = INOVAFARMA_PERMISSIONS.ref("metas-individual:view");

  /** O que o ERP e o Plugin têm de cada Colaborador no Período, somado em todas as Lojas. Lança se o ERP falhar. */
  async function dadosDoPeriodo(periodo: PeriodoResumo, indicadores: Set<IndicadorId>, produtosLista: string[]): Promise<Map<number, DadosColaborador>> {
    const dados = new Map<number, DadosColaborador>();
    const de = (codigo: number) => {
      const d = dados.get(codigo) ?? { indicadores: {}, produtos: {}, descontosCentavos: 0 };
      dados.set(codigo, d);
      return d;
    };
    const datas = { dataInicio: `${periodo.startDate} 00:00:00`, dataFim: `${periodo.endDate} 23:59:59` };
    const deVendas = [...indicadores].filter((i) => INDICADORES_DE_VENDAS[i]);
    const precisaErp = deVendas.length > 0 || produtosLista.length > 0 || indicadores.has("pre-vencidos");
    const conectado = erpClient();
    if (precisaErp && !conectado) throw new Error(SEM_CONEXAO);
    const client = {
      query: <T,>(sql: string, params: Record<string, unknown>) => {
        if (!conectado) throw new Error(SEM_CONEXAO);
        return conectado.query<T>(sql, params);
      },
    };

    if (deVendas.length > 0) {
      for (const r of await client.query<LinhaDesempenho>(desempenhoSql("").sql, datas)) {
        const d = de(Number(r.codigoColaborador));
        for (const i of deVendas) d.indicadores[i] = INDICADORES_DE_VENDAS[i]?.(r);
      }
    }
    if (produtosLista.length > 0) {
      const params: Record<string, unknown> = { ...datas };
      produtosLista.forEach((id, n) => (params[`g${n}`] = id));
      for (const r of await client.query<LinhaVenda>(listaSql(produtosLista.length), params)) {
        const d = de(Number(r.codigoColaborador));
        d.produtos[r.produtoId] = (d.produtos[r.produtoId] ?? 0) + (Number(r.quantidade) || 0);
      }
    }
    if (indicadores.has("pre-vencidos")) {
      // Só o vendido que a Conferência confirma, limitado ao que foi lançado.
      const lancamentos = await preVencidos.listar({ periodoId: periodo.id });
      const codigos = [...new Set(lancamentos.map((l) => l.codigoProduto))];
      const vendas: LinhaVenda[] = [];
      for (let i = 0; i < codigos.length; i += LOTE_PRODUTOS) {
        const lote = codigos.slice(i, i + LOTE_PRODUTOS);
        const params: Record<string, unknown> = { ...datas };
        lote.forEach((codigo, n) => (params[`p${n}`] = codigo));
        vendas.push(...(await client.query<LinhaVenda>(vendasSql(lote.length), params)));
      }
      const conferencia = conferir(lancamentos, vendas.map((v) => ({ codigoColaborador: Number(v.codigoColaborador), produtoId: v.produtoId, quantidade: Number(v.quantidade) || 0 })));
      for (const linha of conferencia) {
        de(linha.codigoColaborador).indicadores["pre-vencidos"] = linha.detalhe.reduce((acc, p) => acc + Math.min(p.quantidadeVendida, p.quantidadeLancada), 0);
      }
    }
    if (indicadores.has("avaliacoes")) {
      for (const a of await avaliacoes.listar({ periodoId: periodo.id })) de(a.codigoColaborador).descontosCentavos += a.valorCentavos;
    }
    return dados;
  }

  /** Apuração ao vivo das Metas do Período, com os Tipos de Meta de agora. Lança se o ERP falhar. */
  async function apurar(periodo: PeriodoResumo): Promise<ApuracaoPeriodo> {
    // Na Apuração do fechamento o Período ainda está aberto: só os Tipos ativos contam.
    const doPeriodo = metasVisiveis(await metas.listar([periodo.id]), await tipos.listar(), { status: "open" });
    const indicadores = new Set<IndicadorId>(doPeriodo.flatMap(({ tipo }) => (tipo.regra.tipo === "percentual" ? [tipo.indicador, tipo.regra.indicadorBase] : [tipo.indicador])));
    const produtosLista = [...new Set(doPeriodo.flatMap(({ meta }) => meta.lista?.produtos.map((p) => p.produtoId) ?? []))];
    const dados = await dadosDoPeriodo(periodo, indicadores, produtosLista);
    const vazio: DadosColaborador = { indicadores: {}, produtos: {}, descontosCentavos: 0 };
    const apuradas: MetaApurada[] = doPeriodo
      .map(({ meta, tipo }) => ({
        metaId: meta.id,
        tipo: { id: tipo.id, nome: tipo.nome, indicador: tipo.indicador, exibicao: tipo.exibicao, mostrarPremio: tipo.mostrarPremio, semAlvo: tipo.semAlvo, premio: descreverPremio(tipo) },
        participantes: meta.participantes.map((p) => apurarParticipante(tipo, meta.lista, p, dados.get(p.codigoColaborador) ?? vazio)),
      }))
      .sort((a, b) => a.tipo.nome.localeCompare(b.tipo.nome));
    return { periodoId: periodo.id, metas: apuradas, apuradoEm: new Date().toISOString() };
  }

  const periodoDoEvento = async (payload: object) => (await periods.list()).find((p) => p.id === (payload as { periodId?: string }).periodId);
  const atorDoEvento = async (payload: object) => {
    const id = (payload as { actorId?: string }).actorId ?? "";
    return { id, name: (await users.list()).find((u) => u.id === id)?.fullname ?? "" };
  };

  /** Grava a Apuração de um Período fechado e registra no Audit Log: é o que fica valendo para os Prêmios. */
  async function congelar(apuracao: ApuracaoPeriodo, periodo: PeriodoResumo, origem: AtributosCongelamento["origem"], actor: { id: string; name: string }) {
    await apuracoes.gravar(apuracao);
    const participacoes = apuracao.metas.flatMap((m) => m.participantes);
    const attributes: AtributosCongelamento = {
      periodo: periodo.name,
      origem,
      metas: apuracao.metas.length,
      participantes: participacoes.length,
      premioCentavos: participacoes.reduce((acc, p) => acc + p.premioCentavos, 0),
    };
    await audit.record({ plugin: APURACAO_PLUGIN, action: APURACAO_ACTIONS.congelar, actor, target: { type: APURACAO_TARGET, id: periodo.id }, attributes });
  }

  /**
   * ADR 0007: a Apuração é feita no `before` do fechamento, que só lê (ERP e stores) e recusa o fechamento se o ERP
   * falhar (fail-closed: um Período fechado nunca fica sem Apuração por falha do ERP). O `after` só grava o que o
   * `before` apurou. Limitada: um fechamento recusado depois do `before` (ex.: conflito de versão) deixa a entrada,
   * que o próximo fechamento do mesmo Período substitui.
   */
  const apuradasNoFechamento = new Map<string, ApuracaoPeriodo>();
  const MAX_PENDENTES = 100;
  events.before(
    "closing_period.close",
    async (ctx) => {
      const periodo = await periodoDoEvento(ctx.payload);
      if (!periodo) return;
      try {
        const apuracao = await apurar({ ...periodo, status: "closed" });
        apuradasNoFechamento.delete(periodo.id);
        if (apuradasNoFechamento.size >= MAX_PENDENTES) apuradasNoFechamento.delete(apuradasNoFechamento.keys().next().value as string);
        apuradasNoFechamento.set(periodo.id, apuracao);
      } catch {
        ctx.cancel(FECHAMENTO_SEM_APURACAO);
      }
    },
    { timeoutMs: TEMPO_APURACAO_MS, module: "inovafarma" },
  );
  events.after(
    "closing_period.close",
    async (payload) => {
      const periodo = await periodoDoEvento(payload);
      const apuracao = periodo && apuradasNoFechamento.get(periodo.id);
      if (!periodo || !apuracao) return;
      apuradasNoFechamento.delete(periodo.id);
      await congelar(apuracao, periodo, "fechamento", await atorDoEvento(payload));
    },
    { module: "inovafarma" },
  );
  events.after(
    "closing_period.reopen",
    async (payload) => {
      const periodo = await periodoDoEvento(payload);
      if (!periodo || !(await apuracoes.apuracao(periodo.id))) return;
      await apuracoes.descartar(periodo.id);
      await audit.record({
        plugin: APURACAO_PLUGIN,
        action: APURACAO_ACTIONS.descartar,
        actor: await atorDoEvento(payload),
        target: { type: APURACAO_TARGET, id: periodo.id },
        attributes: { periodo: periodo.name },
      });
    },
    { module: "inovafarma" },
  );

  /**
   * Apuração do Período: a gravada se ele está fechado, senão ao vivo. Um Período fechado sem Apuração gravada (fechado
   * antes das Metas existirem, ou a gravação no `after` falhou) é apurado com o ERP de agora e gravado na primeira
   * consulta, com entrada no Audit Log em nome de quem consultou: assim a diferença para o fechamento fica visível.
   */
  async function apuracaoDe(periodo: PeriodoResumo, ator: { id: string; name: string }): Promise<{ apuracao: ApuracaoPeriodo; congelada: boolean }> {
    if (periodo.status === "open") {
      // Igual ao Montar Metas: cópia automática e uma Meta por Tipo de Meta ativo.
      if (!(await montagem.preparar(ator, periodo, await periods.list()))) throw new Error(erpClient() ? ERP_INDISPONIVEL : SEM_CONEXAO);
      return { apuracao: await apurar(periodo), congelada: false };
    }
    const gravada = await apuracoes.apuracao(periodo.id);
    if (gravada) return { apuracao: gravada, congelada: true };
    const apuracao = await apurar(periodo);
    await congelar(apuracao, periodo, "consulta", ator);
    return { apuracao, congelada: true };
  }

  routes.get("/metas/acompanhamento", auth, async (c: AuthContext) => {
    const acesso = await visualizacoesDasMetas(c.get("user"), permissions.has, vinculos);
    if (!acesso.geral && !acesso.lojas) return c.json({ error: geralRef.deniedMessage }, 403);
    const visualizacao = (c.req.query("visualizacao") ?? (acesso.geral ? "geral" : "loja")) as VisualizacaoMetas;
    if (visualizacao === "geral" && !acesso.geral) return c.json({ error: geralRef.deniedMessage }, 403);
    if (visualizacao === "loja" && !acesso.lojas) return c.json({ error: lojaRef.deniedMessage }, 403);
    if (visualizacao !== "geral" && visualizacao !== "loja") return c.json({ error: "Parâmetro 'visualizacao' deve ser geral ou loja." }, 400);

    const periodo = (await periods.list()).find((p) => p.id === c.req.query("periodoId"));
    if (!periodo) return c.json({ error: PERIODO_NAO_ENCONTRADO }, 404);
    const pedida = c.req.query("codigoEmpresa");
    const loja = pedida && Number.isInteger(Number(pedida)) ? Number(pedida) : null;
    if (visualizacao === "loja" && loja !== null && !acesso.lojas!.includes(loja)) return c.json({ error: LOJA_FORA }, 403);
    // Geral sem Loja: todos. Loja sem Loja escolhida: as Lojas do Vínculo do Usuário.
    const filtro = loja !== null ? [loja] : visualizacao === "loja" ? acesso.lojas! : null;

    let resultado;
    try {
      resultado = await apuracaoDe(periodo, ator(c));
    } catch (err: unknown) {
      return c.json({ error: err instanceof Error && err.message === SEM_CONEXAO ? SEM_CONEXAO : ERP_INDISPONIVEL }, 503);
    }
    // A Loja só escolhe quem aparece: as confirmadas no Vínculo de cada Colaborador.
    const lojas = new Map((await vinculos.list()).filter((v) => !vinculoDesfeito(v)).map((v) => [v.codigoColaborador, v.lojas]));
    const linhas = resultado.apuracao.metas
      .flatMap(({ metaId, tipo, participantes }) => participantes.map((p) => ({ metaId, tipo, ...p, lojas: lojas.get(p.codigoColaborador) ?? [] })))
      .filter((l) => filtro === null || l.lojas.some((codigo) => filtro.includes(codigo)));
    return c.json({ periodo, congelada: resultado.congelada, apuradoEm: resultado.apuracao.apuradoEm, linhas, totais: totaisPorColaborador(linhas) });
  })
  // Minhas Metas: só as Participações do Colaborador vinculado, cortadas pela Exibição no servidor.
  routes.get("/metas/minhas", auth, async (c: AuthContext) => {
    const codigo = await colaboradorDasMinhasMetas(c.get("user"), permissions.has, vinculos);
    if (codigo === null) return c.json({ error: individualRef.deniedMessage }, 403);
    const periodo = (await periods.list()).find((p) => p.id === c.req.query("periodoId"));
    if (!periodo) return c.json({ error: PERIODO_NAO_ENCONTRADO }, 404);
    let resultado;
    try {
      resultado = await apuracaoDe(periodo, ator(c));
    } catch (err: unknown) {
      return c.json({ error: err instanceof Error && err.message === SEM_CONEXAO ? SEM_CONEXAO : ERP_INDISPONIVEL }, 503);
    }
    const minhas = resultado.apuracao.metas.flatMap(({ metaId, tipo, participantes }) => {
      const meu = participantes.find((p) => p.codigoColaborador === codigo);
      return meu ? [minhaMeta(metaId, tipo, meu)] : [];
    });
    return c.json({ periodo, congelada: resultado.congelada, metas: minhas });
  });
}
