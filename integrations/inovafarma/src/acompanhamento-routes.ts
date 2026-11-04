import type { MiddlewareHandler } from "hono";
import type { ModuleContext } from "@platform/core/module";
import { APURACAO_ACTIONS, APURACAO_PLUGIN, APURACAO_TARGET, type AtributosCongelamento } from "./apuracao-audit.js";
import { apurarParticipante, totaisPorColaborador, type DadosColaborador } from "./apuracao.js";
import type { ApuracaoPeriodo, ApuracaoStore, MetaApurada } from "./apuracao-store.js";
import type { AvaliacaoStore } from "./avaliacoes-store.js";
import { desempenhoSql } from "./desempenho-vendas.js";
import type { IndicadorId } from "./indicadores.js";
import { listaSql, type LinhaLista } from "./lista-produtos.js";
import { ator, ERP_INDISPONIVEL, erroDoErp, PERIODO_NAO_ENCONTRADO, SEM_CONEXAO, vinculoDoUsuario, type AuthContext } from "./metas-comum.js";
import type { MetaStore } from "./metas-store.js";
import { metasDoPeriodo, metasVisiveis } from "./metas-do-periodo.js";
import type { UsersService } from "./colaboradores-routes.js";
import { minhaMeta, type MinhaBaixa } from "./minhas-metas.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import type { PeriodoResumo, PeriodsService } from "./pre-vencidos-routes.js";
import { baixaPublica, baixasDoPeriodo, type BaixasDoPeriodoDeps } from "./baixas-do-periodo.js";
import type { EstoquePreVencidoStore } from "./estoque-pre-vencidos-store.js";
import type { BaixasCongeladasStore } from "./baixas-congeladas-store.js";
import type { CorrecaoBaixaStore } from "./correcoes-baixa-store.js";
import { descreverPremio, temLista, type TipoMeta } from "./tipos-meta.js";
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
  /** Estoque de Pré-vencidos: as Baixas dão o Indicador "Pré-vencidos vendidos". */
  estoque: EstoquePreVencidoStore;
  /** Baixas gravadas no fechamento: num Período fechado, o Indicador soma as gravadas. */
  congeladas: BaixasCongeladasStore;
  /** Correções de Baixa: fixam quanto uma venda baixa. */
  correcoes: CorrecaoBaixaStore;
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
    "venda-liquida": (r) => Math.round(n(r.totalLiquido) * 100),
    "desconto-valor": (r) => Math.round(n(r.totalDesconto) * 100),
    "desconto-percent": (r) => (n(r.totalBruto) > 0 ? (n(r.totalDesconto) / n(r.totalBruto)) * 100 : 0),
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

export function registerAcompanhamentoRoutes(deps: AcompanhamentoRoutesDeps): void {
  const { routes, permissions, auth, events, erpClient, tipos, metas, vinculos, avaliacoes, estoque, congeladas, correcoes, apuracoes, periods, audit, users } = deps;
  const montagem = metasDoPeriodo({ erpClient, tipos, metas, audit });
  const baixasDeps: BaixasDoPeriodoDeps = { erpClient, store: estoque, congeladas, correcoes };
  const geralRef = INOVAFARMA_PERMISSIONS.ref("metas-geral:view");
  const lojaRef = INOVAFARMA_PERMISSIONS.ref("metas-loja:view");
  const individualRef = INOVAFARMA_PERMISSIONS.ref("metas-individual:view");
  const manageRef = INOVAFARMA_PERMISSIONS.ref("metas:manage");

  /**
   * O que o ERP e o Plugin têm de cada Colaborador no Período, somado em todas as Lojas, e o vendido da Lista de cada
   * Tipo de Meta de Lista (por Tipo, por Colaborador). Lança se o ERP falhar.
   */
  async function dadosDoPeriodo(
    periodo: PeriodoResumo,
    indicadores: Set<IndicadorId>,
    tiposLista: TipoMeta[],
  ): Promise<{ dados: Map<number, DadosColaborador>; listas: Map<string, Map<number, number>> }> {
    const dados = new Map<number, DadosColaborador>();
    const listas = new Map<string, Map<number, number>>();
    const de = (codigo: number) => {
      const d = dados.get(codigo) ?? { indicadores: {}, descontosCentavos: 0 };
      dados.set(codigo, d);
      return d;
    };
    const datas = { dataInicio: `${periodo.startDate} 00:00:00`, dataFim: `${periodo.endDate} 23:59:59` };
    const deVendas = [...indicadores].filter((i) => INDICADORES_DE_VENDAS[i]);
    const precisaErp = deVendas.length > 0 || tiposLista.length > 0;
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
    for (const tipo of tiposLista) {
      if (!tipo.lista) continue;
      const { sql, params } = listaSql(tipo.lista);
      const porColaborador = new Map<number, number>();
      // Em unidades, a quantidade vendida; em R$, o valor líquido em centavos, como os demais Indicadores em R$.
      const realizado = (r: LinhaLista) => (tipo.lista?.unidade === "reais" ? Math.round((Number(r.valor) || 0) * 100) : Number(r.quantidade) || 0);
      for (const r of await client.query<LinhaLista>(sql, { ...datas, ...params })) porColaborador.set(Number(r.codigoColaborador), realizado(r));
      listas.set(tipo.id, porColaborador);
    }
    if (indicadores.has("pre-vencidos")) {
      // O vendido de Pré-vencido é o que as Baixas do Período creditam ao Colaborador, em todas as Lojas.
      for (const b of await baixasDoPeriodo(baixasDeps, periodo)) {
        const d = de(b.venda.codigoColaborador);
        d.indicadores["pre-vencidos"] = (d.indicadores["pre-vencidos"] ?? 0) + b.quantidade;
      }
    }
    if (indicadores.has("avaliacoes")) {
      for (const a of await avaliacoes.listar({ periodoId: periodo.id })) de(a.codigoColaborador).descontosCentavos += a.valorCentavos;
    }
    return { dados, listas };
  }

  /** Apuração ao vivo das Metas do Período, com os Tipos de Meta de agora. Lança se o ERP falhar. */
  async function apurar(periodo: PeriodoResumo): Promise<ApuracaoPeriodo> {
    // Na Apuração do fechamento o Período ainda está aberto: só os Tipos ativos contam.
    const doPeriodo = metasVisiveis(await metas.listar([periodo.id]), await tipos.listar(), { status: "open" });
    const indicadores = new Set<IndicadorId>(doPeriodo.flatMap(({ tipo }) => (tipo.regra.tipo === "percentual" ? [tipo.indicador, tipo.regra.indicadorBase] : [tipo.indicador])));
    const tiposLista = doPeriodo.flatMap(({ tipo }) => (temLista(tipo.indicador) ? [tipo] : []));
    const { dados, listas } = await dadosDoPeriodo(periodo, indicadores, tiposLista);
    const vazio: DadosColaborador = { indicadores: {}, descontosCentavos: 0 };
    /** O vendido da Lista entra como o Realizado comum do Indicador Lista de Produtos daquele Tipo de Meta. */
    const dadosDe = (tipo: TipoMeta, codigo: number): DadosColaborador => {
      const d = dados.get(codigo) ?? vazio;
      return temLista(tipo.indicador) ? { ...d, indicadores: { ...d.indicadores, "lista-produtos": listas.get(tipo.id)?.get(codigo) ?? 0 } } : d;
    };
    const apuradas: MetaApurada[] = doPeriodo
      .map(({ meta, tipo }) => ({
        metaId: meta.id,
        tipo: {
          id: tipo.id,
          nome: tipo.nome,
          indicador: tipo.indicador,
          exibicao: tipo.exibicao,
          mostrarPremio: tipo.mostrarPremio,
          semAlvo: tipo.semAlvo,
          lista: tipo.lista,
          premio: descreverPremio(tipo),
        },
        participantes: meta.participantes.map((p) => apurarParticipante(tipo, p, dadosDe(tipo, p.codigoColaborador))),
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
      // Igual ao Montar Metas: a cópia automática no primeiro acesso ao Período.
      if (!(await montagem.preparar(ator, periodo, await periods.list()))) throw new Error(erpClient() ? ERP_INDISPONIVEL : SEM_CONEXAO);
      return { apuracao: await apurar(periodo), congelada: false };
    }
    const gravada = await apuracoes.apuracao(periodo.id);
    if (gravada) return { apuracao: gravada, congelada: true };
    const apuracao = await apurar(periodo);
    await congelar(apuracao, periodo, "consulta", ator);
    return { apuracao, congelada: true };
  }

  /** O Período imediatamente anterior pela data: o que termina por último antes do início deste. */
  const periodoAnterior = async (periodo: PeriodoResumo) =>
    (await periods.list())
      .filter((p) => p.endDate < periodo.startDate)
      .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];

  /** Apuração do Período anterior, por Tipo de Meta; sem Período anterior ou com o ERP fora, vazia. */
  async function apuracaoAnterior(periodo: PeriodoResumo, quem: { id: string; name: string }) {
    const anterior = await periodoAnterior(periodo);
    if (!anterior) return { periodo: null, metas: [] as MetaApurada[] };
    try {
      return { periodo: { id: anterior.id, name: anterior.name }, metas: (await apuracaoDe(anterior, quem)).apuracao.metas };
    } catch {
      return { periodo: { id: anterior.id, name: anterior.name }, metas: [] as MetaApurada[] };
    }
  }

  // Montar Metas (Tabela): o Alvo e o Realizado de cada Participante no Período anterior, na mesma Meta (Tipo de Meta).
  routes.get("/metas/anterior", auth, async (c: AuthContext) => {
    if (!permissions.has(c.get("user")?.permissions, manageRef.key)) return c.json({ error: manageRef.deniedMessage }, 403);
    const periodo = (await periods.list()).find((p) => p.id === c.req.query("periodoId"));
    if (!periodo) return c.json({ error: PERIODO_NAO_ENCONTRADO }, 404);
    const anterior = await apuracaoAnterior(periodo, ator(c));
    return c.json({
      periodo: anterior.periodo,
      metas: anterior.metas.map(({ tipo, participantes }) => ({
        tipoId: tipo.id,
        participantes: participantes.map(({ codigoColaborador, alvo, realizado, atingimento, atingida, resultado }) => ({
          codigoColaborador,
          alvo,
          realizado,
          atingimento: atingimento !== null && Number.isFinite(atingimento) ? atingimento : null,
          atingida,
          resultado,
        })),
      })),
    });
  });

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
      return c.json(erroDoErp(err), 503);
    }
    // A Loja só escolhe quem aparece: as confirmadas no Vínculo de cada Colaborador.
    const lojas = new Map((await vinculos.list()).filter((v) => !vinculoDesfeito(v)).map((v) => [v.codigoColaborador, v.lojas]));
    // O mesmo Participante na mesma Meta (Tipo de Meta) do Período anterior, para comparar na Tabela.
    const anterior = await apuracaoAnterior(periodo, ator(c));
    const antes = new Map(anterior.metas.map((m) => [m.tipo.id, new Map(m.participantes.map((p) => [p.codigoColaborador, p]))]));
    const resumoAnterior = (tipoId: string, codigo: number) => {
      const p = antes.get(tipoId)?.get(codigo);
      return p ? { alvo: p.alvo, realizado: p.realizado, atingimento: p.atingimento !== null && Number.isFinite(p.atingimento) ? p.atingimento : null, atingida: p.atingida, premioCentavos: p.premioCentavos } : undefined;
    };
    const linhas = resultado.apuracao.metas
      .flatMap(({ metaId, tipo, participantes }) =>
        participantes.map((p) => {
          const a = resumoAnterior(tipo.id, p.codigoColaborador);
          return { metaId, tipo, ...p, lojas: lojas.get(p.codigoColaborador) ?? [], ...(a ? { anterior: a } : {}) };
        }),
      )
      .filter((l) => filtro === null || l.lojas.some((codigo) => filtro.includes(codigo)));
    return c.json({ periodo, congelada: resultado.congelada, apuradoEm: resultado.apuracao.apuradoEm, periodoAnterior: anterior.periodo, linhas, totais: totaisPorColaborador(linhas) });
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
      return c.json(erroDoErp(err), 503);
    }
    // O Período anterior, na mesma Meta (Tipo de Meta), cortado pela mesma Exibição.
    const anterior = await apuracaoAnterior(periodo, ator(c));
    const minhas = resultado.apuracao.metas.flatMap(({ metaId, tipo, participantes }) => {
      const meu = participantes.find((p) => p.codigoColaborador === codigo);
      if (!meu) return [];
      const antes = anterior.metas.find((m) => m.tipo.id === tipo.id);
      const meuAntes = antes?.participantes.find((p) => p.codigoColaborador === codigo);
      const cortado = meuAntes && antes ? minhaMeta(antes.metaId, tipo, meuAntes) : undefined;
      const minha = { ...minhaMeta(metaId, tipo, meu), indicador: tipo.indicador, ...(cortado ? { anterior: { alvo: cortado.alvo, realizado: cortado.realizado, atingida: cortado.atingida } } : {}) };
      return [{ minha, indicador: tipo.indicador }];
    });
    // Quem tem Meta de Pré-vencidos vê as Baixas que formam o Realizado: venda, produto e quantidade.
    let baixas: MinhaBaixa[] = [];
    if (minhas.some((m) => m.indicador === "pre-vencidos")) {
      try {
        baixas = (await baixasDoPeriodo(baixasDeps, periodo))
          .filter((b) => b.venda.codigoColaborador === codigo)
          .sort((a, b) => a.venda.data.localeCompare(b.venda.data) || a.venda.vendaId - b.venda.vendaId)
          .map((b) => {
            const { correcao, ...baixa } = baixaPublica(b);
            return { ...baixa, ...(correcao ? { correcao: { quantidade: correcao.quantidade, motivo: correcao.motivo } } : {}) };
          });
      } catch (err: unknown) {
        return c.json(erroDoErp(err), 503);
      }
    }
    return c.json({ periodo, congelada: resultado.congelada, periodoAnterior: anterior.periodo, metas: minhas.map((m) => m.minha), baixas });
  });
}
