import type { ModuleContext } from "@platform/core/module";
import { baixasDaLoja, type VendaDaLoja } from "./baixas-da-loja.js";
import type { BaixasCongeladas, BaixasCongeladasStore } from "./baixas-congeladas-store.js";
import type { EstoquePreVencidoStore, ItemPreVencido } from "./estoque-pre-vencidos-store.js";
import { SEM_CONEXAO } from "./metas-comum.js";

interface ErpQuery {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
}

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
}

export interface BaixasDoPeriodoDeps {
  erpClient: () => ErpQuery | undefined;
  store: EstoquePreVencidoStore;
  /** Baixas gravadas no fechamento dos Closing Periods. */
  congeladas: BaixasCongeladasStore;
}

/** Limites do Período na hora do ERP, comparáveis como texto com a data da venda. */
const limites = (periodo: Pick<PeriodoDasBaixas, "startDate" | "endDate">) => ({ inicio: `${periodo.startDate} 00:00:00`, fim: `${periodo.endDate} 23:59:59` });

const cliente = (erpClient: BaixasDoPeriodoDeps["erpClient"]) => {
  const client = erpClient();
  if (!client) throw new Error(SEM_CONEXAO);
  return client;
};

/**
 * Baixas da Loja ao vivo nas vendas do Período e Restante de cada Item no fim dele, partindo do último congelamento
 * anterior ao Período (as vendas até ele já estão contadas).
 */
async function aoVivo({ erpClient, congeladas }: BaixasDoPeriodoDeps, periodo: PeriodoDasBaixas, codigoLoja: number, itens: readonly ItemPreVencido[]) {
  const { inicio, fim } = limites(periodo);
  const base = (await congeladas.daLoja(codigoLoja)).filter((c) => c.ate < inicio).at(-1) ?? null;
  const { baixas, restante } = await baixasDaLoja(cliente(erpClient), codigoLoja, itens, { base, ate: fim });
  const produtos = new Map(itens.map((i) => [i.produtoId, { nomeProduto: i.nomeProduto, codigoBarra: i.codigoBarra }]));
  const doPeriodo: BaixaDoPeriodo[] = baixas
    .filter(({ venda }) => venda.data >= inicio)
    .map(({ venda, quantidade }) => ({ codigoLoja, venda, quantidade, ...(produtos.get(venda.produtoId) ?? { nomeProduto: "", codigoBarra: null }) }));
  return { baixas: doPeriodo, restante };
}

/**
 * Baixas de Pré-vencido das vendas feitas no Closing Period, Loja a Loja (todas as Lojas com Itens, ou só as pedidas).
 * Único lugar que diz quais são as Baixas de um Período: a aba Baixas e o Indicador "Pré-vencidos vendidos" leem daqui.
 * Fechado, valem as gravadas no fechamento; aberto (ou fechado sem nada gravado), o motor recalcula com as vendas do
 * ERP a partir do último congelamento. Lança `SEM_CONEXAO` sem conexão e o erro do ERP se ele falhar.
 */
export async function baixasDoPeriodo(deps: BaixasDoPeriodoDeps, periodo: PeriodoDasBaixas, lojas?: readonly number[]): Promise<BaixaDoPeriodo[]> {
  if (periodo.status === "closed") {
    const gravadas = await deps.congeladas.doPeriodo(periodo.id);
    if (gravadas.length > 0) return gravadas.filter((c) => !lojas || lojas.includes(c.codigoLoja)).flatMap((c) => c.baixas);
  }
  const resultado: BaixaDoPeriodo[] = [];
  for (const codigoLoja of lojas ?? (await deps.store.lojas())) {
    const itens = await deps.store.listar(codigoLoja);
    if (itens.length > 0) resultado.push(...(await aoVivo(deps, periodo, codigoLoja, itens)).baixas);
  }
  return resultado;
}

/** Restante de agora de cada Item da Loja, a partir do último congelamento. Lança como `baixasDoPeriodo`. */
export async function restanteDoEstoque({ erpClient, congeladas }: BaixasDoPeriodoDeps, codigoLoja: number, itens: readonly ItemPreVencido[]): Promise<Record<string, number>> {
  if (itens.length === 0) return {};
  const base = (await congeladas.daLoja(codigoLoja)).at(-1) ?? null;
  return (await baixasDaLoja(cliente(erpClient), codigoLoja, itens, { base })).restante;
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
  periods: { list(): Promise<PeriodoDasBaixas[]> };
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
