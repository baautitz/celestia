import type { ModuleContext } from "@platform/core/module";
import { baixasDaLoja, type VendaDaLoja } from "./baixas-da-loja.js";
import type { BaixasCongeladas, BaixasCongeladasStore } from "./baixas-congeladas-store.js";
import { chaveDaLinha, type VendaParaBaixa } from "./baixas-pre-vencidos.js";
import type { CorrecaoBaixa, CorrecaoBaixaStore } from "./correcoes-baixa-store.js";
import type { EstoquePreVencidoStore, ItemPreVencido } from "./estoque-pre-vencidos-store.js";
import { SEM_CONEXAO, type ErpQuery } from "./metas-comum.js";
import type { PeriodsService } from "./pre-vencidos-routes.js";

/** Closing Period das Baixas: as datas (`AAAA-MM-DD`) limitam as vendas que contam; o fechado mostra as gravadas. */
export interface PeriodoDasBaixas {
  id: string;
  startDate: string;
  endDate: string;
  status?: "open" | "closed";
}

/** Uma Baixa de Pré-vencido de um Closing Period: a venda, a Loja e o produto, como a aba Baixas e o Indicador usam. */
export interface BaixaDoPeriodo {
  codigoLoja: number;
  venda: VendaDaLoja;
  /** Quanto da venda foi Pré-vencido. */
  quantidade: number;
  nomeProduto: string;
  codigoBarra: string | null;
  /** Correção de Baixa da venda, se houver: a `quantidade` acima já a reflete. */
  correcao?: Pick<CorrecaoBaixa, "id" | "quantidade" | "motivo" | "autorNome" | "version">;
}

/** Uma Baixa como a API devolve (aba Baixas e Minhas Metas): a venda, o produto e quanto dela foi Pré-vencido. Nunca o código do produto no ERP. */
export interface BaixaPublica {
  vendaId: number;
  /** Hora do ERP, `AAAA-MM-DD HH:MM:SS`. */
  data: string;
  /** Identificador opaco do produto. */
  produtoId: string;
  nomeProduto: string;
  codigoBarra: string | null;
  quantidadeVendida: number;
  /** Quanto da venda foi Pré-vencido. */
  quantidade: number;
  /** Correção de Baixa desta venda: a `quantidade` acima já a reflete. */
  correcao?: BaixaDoPeriodo["correcao"];
}

export const baixaPublica = ({ venda, quantidade, nomeProduto, codigoBarra, correcao }: BaixaDoPeriodo): BaixaPublica => ({
  vendaId: venda.vendaId,
  data: venda.data,
  produtoId: venda.produtoId,
  nomeProduto,
  codigoBarra,
  quantidadeVendida: venda.quantidade,
  quantidade,
  ...(correcao ? { correcao } : {}),
});

export interface BaixasDoPeriodoDeps {
  erpClient: () => ErpQuery | undefined;
  store: EstoquePreVencidoStore;
  /** Baixas gravadas no fechamento dos Closing Periods. */
  congeladas: BaixasCongeladasStore;
  /** Correções de Baixa: fixam quanto uma venda baixa. */
  correcoes: CorrecaoBaixaStore;
}

/** Limites do Período na hora do ERP, comparáveis como texto com a data da venda. */
const limites = (periodo: Pick<PeriodoDasBaixas, "startDate" | "endDate">) => ({ inicio: `${periodo.startDate} 00:00:00`, fim: `${periodo.endDate} 23:59:59` });

const cliente = (erpClient: BaixasDoPeriodoDeps["erpClient"]) => {
  const client = erpClient();
  if (!client) throw new Error(SEM_CONEXAO);
  return client;
};

/** As Correções da Loja pela `chaveDaLinha`. */
async function correcoesDaLoja(correcoes: CorrecaoBaixaStore, codigoLoja: number) {
  return new Map((await correcoes.daLoja(codigoLoja)).map((c) => [chaveDaLinha(c), c]));
}
const quantidades = (porLinha: Map<string, CorrecaoBaixa>) => Object.fromEntries([...porLinha].map(([chave, c]) => [chave, c.quantidade]));

/**
 * Baixas da Loja ao vivo nas vendas do Período e Restante de cada Item no fim dele, partindo do último congelamento
 * anterior ao Período (as vendas até ele já estão contadas). `semCorrecao` (uma `chaveDaLinha`) calcula aquela linha
 * como se não tivesse Correção.
 */
async function aoVivo({ erpClient, congeladas, correcoes }: BaixasDoPeriodoDeps, periodo: PeriodoDasBaixas, codigoLoja: number, itens: readonly ItemPreVencido[], semCorrecao?: string) {
  const { inicio, fim } = limites(periodo);
  const base = (await congeladas.daLoja(codigoLoja)).filter((c) => c.ate < inicio).at(-1) ?? null;
  const porLinha = await correcoesDaLoja(correcoes, codigoLoja);
  if (semCorrecao !== undefined) porLinha.delete(semCorrecao);
  const { baixas, restante } = await baixasDaLoja(cliente(erpClient), codigoLoja, itens, { base, ate: fim, correcoes: quantidades(porLinha) });
  const produtos = new Map(itens.map((i) => [i.produtoId, { nomeProduto: i.nomeProduto, codigoBarra: i.codigoBarra }]));
  const doPeriodo: BaixaDoPeriodo[] = baixas
    .filter(({ venda }) => venda.data >= inicio)
    .map(({ venda, quantidade }) => {
      const correcao = porLinha.get(chaveDaLinha(venda));
      return {
        codigoLoja,
        venda,
        quantidade,
        ...(produtos.get(venda.produtoId) ?? { nomeProduto: "", codigoBarra: null }),
        ...(correcao ? { correcao: { id: correcao.id, quantidade: correcao.quantidade, motivo: correcao.motivo, autorNome: correcao.autorNome, version: correcao.version } } : {}),
      };
    });
  return { baixas: doPeriodo, restante };
}

/**
 * Baixas de Pré-vencido das vendas feitas no Closing Period, Loja a Loja (todas as Lojas com Itens, ou só as pedidas).
 * Único lugar que diz quais são as Baixas de um Período: a aba Baixas e o Indicador "Pré-vencidos vendidos" leem daqui.
 * Fechado, valem só as gravadas no fechamento (nenhuma, se nada foi gravado): o Período fechado nunca é recalculado.
 * Aberto, o motor calcula com as vendas do ERP a partir do último congelamento. Lança `SEM_CONEXAO` sem conexão e o
 * erro do ERP se ele falhar.
 */
export async function baixasDoPeriodo(deps: BaixasDoPeriodoDeps, periodo: PeriodoDasBaixas, lojas?: readonly number[]): Promise<BaixaDoPeriodo[]> {
  if (periodo.status === "closed") {
    return (await deps.congeladas.doPeriodo(periodo.id)).filter((c) => !lojas || lojas.includes(c.codigoLoja)).flatMap((c) => c.baixas);
  }
  const resultado: BaixaDoPeriodo[] = [];
  for (const codigoLoja of lojas ?? (await deps.store.lojas())) {
    const itens = await deps.store.listar(codigoLoja);
    if (itens.length > 0) resultado.push(...(await aoVivo(deps, periodo, codigoLoja, itens)).baixas);
  }
  return resultado;
}

/**
 * Teto de uma Correção de Baixa: quanto a linha de venda baixaria no Período aberto sem a própria Correção, ou seja, o
 * que a venda teve limitado ao que havia no Estoque para ela. Lança como `baixasDoPeriodo`.
 */
export async function tetoDaCorrecao(deps: BaixasDoPeriodoDeps, periodo: PeriodoDasBaixas, codigoLoja: number, linha: Pick<VendaParaBaixa, "vendaId" | "produtoId">): Promise<number> {
  const chave = chaveDaLinha(linha);
  const itens = await deps.store.listar(codigoLoja);
  const { baixas } = await aoVivo(deps, periodo, codigoLoja, itens, chave);
  return baixas.find((b) => chaveDaLinha(b.venda) === chave)?.quantidade ?? 0;
}

/** Restante de agora de cada Item da Loja, a partir do último congelamento. Lança como `baixasDoPeriodo`. */
export async function restanteDoEstoque({ erpClient, congeladas, correcoes }: BaixasDoPeriodoDeps, codigoLoja: number, itens: readonly ItemPreVencido[]): Promise<Record<string, number>> {
  if (itens.length === 0) return {};
  const base = (await congeladas.daLoja(codigoLoja)).at(-1) ?? null;
  const correcoesDeAgora = quantidades(await correcoesDaLoja(correcoes, codigoLoja));
  return (await baixasDaLoja(cliente(erpClient), codigoLoja, itens, { base, correcoes: correcoesDeAgora })).restante;
}

/** O que o fechamento do Período grava: em cada Loja com Itens, as Baixas dele e o Restante no seu fim. Só lê. */
export async function congelamentoDoPeriodo(deps: BaixasDoPeriodoDeps, periodo: PeriodoDasBaixas): Promise<BaixasCongeladas[]> {
  const congeladoEm = new Date().toISOString();
  const resultado: BaixasCongeladas[] = [];
  for (const codigoLoja of await deps.store.lojas()) {
    const itens = await deps.store.listar(codigoLoja);
    if (itens.length === 0) continue;
    const { baixas, restante } = await aoVivo(deps, periodo, codigoLoja, itens);
    const porItem = Object.fromEntries(itens.map((i) => [i.id, { quantidade: i.quantidade, restante: restante[i.id] ?? i.quantidade }]));
    resultado.push({ periodoId: periodo.id, codigoLoja, ate: limites(periodo).fim, baixas, itens: porItem, congeladoEm });
  }
  return resultado;
}

const FECHAMENTO_SEM_BAIXAS = "ERP InovaFarma indisponível: não foi possível calcular as Baixas de Pré-vencido, e o Período não pode ser fechado agora. Tente novamente em instantes.";
/** O fechamento consulta as vendas de todas as Lojas com Estoque: mais que os 2 s padrão de um handler. */
const TEMPO_CONGELAMENTO_MS = 120_000;
const MAX_PENDENTES = 100;

export interface CongelamentoBaixasDeps extends BaixasDoPeriodoDeps {
  events: Pick<ModuleContext["events"], "before" | "after">;
  periods: PeriodsService;
}

/**
 * Congela as Baixas no fechamento do Closing Period, como a Apuração (ADR 0007): o `before` calcula (só lê) e recusa o
 * fechamento se o ERP falhar, sem gravar nada; o `after` grava. Reabrir descarta o congelado.
 */
export function registerCongelamentoBaixas({ events, periods, ...deps }: CongelamentoBaixasDeps): void {
  const periodoId = (payload: object) => (payload as { periodId?: string }).periodId ?? "";
  const pendentes = new Map<string, BaixasCongeladas[]>();

  events.before(
    "closing_period.close",
    async (ctx) => {
      const periodo = (await periods.list()).find((p) => p.id === periodoId(ctx.payload));
      if (!periodo) return;
      try {
        const congelamento = await congelamentoDoPeriodo(deps, periodo);
        pendentes.delete(periodo.id);
        if (pendentes.size >= MAX_PENDENTES) pendentes.delete(pendentes.keys().next().value as string);
        pendentes.set(periodo.id, congelamento);
      } catch {
        ctx.cancel(FECHAMENTO_SEM_BAIXAS);
      }
    },
    { timeoutMs: TEMPO_CONGELAMENTO_MS, module: "inovafarma" },
  );
  events.after(
    "closing_period.close",
    async (payload) => {
      const congelamento = pendentes.get(periodoId(payload));
      if (!congelamento) return;
      pendentes.delete(periodoId(payload));
      await deps.congeladas.gravar(periodoId(payload), congelamento);
    },
    { module: "inovafarma" },
  );
  events.after("closing_period.reopen", (payload) => deps.congeladas.descartar(periodoId(payload)), { module: "inovafarma" });
}
