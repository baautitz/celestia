import type { ModuleContext } from "@platform/core/module";
import { baixasDaLoja, type VendaDaLoja } from "./baixas-da-loja.js";
import type { BaixasCongeladas, BaixasCongeladasStore } from "./baixas-congeladas-store.js";
import type { BaixaDeVenda } from "./baixas-pre-vencidos.js";
import type { EstoquePreVencidoStore, ItemPreVencido } from "./estoque-pre-vencidos-store.js";

interface ErpQuery {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
}

/** O que as Baixas precisam de um Closing Period (forma do serviço `periods` do Module `closing_period`, ADR 0002). */
export interface PeriodoDasBaixas {
  id: string;
  startDate: string;
  endDate: string;
  status: "open" | "closed";
}

/** As Baixas dependem do ERP e ele não está configurado (`semConexao`) ou falhou. */
export class BaixasSemErpError extends Error {
  constructor(readonly semConexao: boolean) {
    super(semConexao ? "ERP sem conexão" : "ERP indisponível");
  }
}

export interface BaixasPreVencidosDeps {
  erpClient: () => ErpQuery | undefined;
  estoque: EstoquePreVencidoStore;
  congeladas: BaixasCongeladasStore;
}

/** Limites do Período na hora do ERP, comparáveis como texto com a data da venda. */
const limites = (periodo: Pick<PeriodoDasBaixas, "startDate" | "endDate">) => ({ inicio: `${periodo.startDate} 00:00:00`, fim: `${periodo.endDate} 23:59:59` });

/**
 * Baixas de Pré-vencido por Closing Period. Um Período fechado mostra as Baixas gravadas no fechamento; o aberto (e o
 * fechado sem nada gravado) é calculado ao vivo a partir do último congelamento anterior a ele.
 */
export function baixasPreVencidos({ erpClient, estoque, congeladas }: BaixasPreVencidosDeps) {
  const cliente = () => {
    const client = erpClient();
    if (!client) throw new BaixasSemErpError(true);
    return client;
  };
  const doErp = async <T,>(consulta: () => Promise<T>) => {
    try {
      return await consulta();
    } catch (err) {
      throw err instanceof BaixasSemErpError ? err : new BaixasSemErpError(false);
    }
  };

  /** Baixas da Loja ao vivo no Período e Restante de cada Item no fim dele, partindo do congelamento anterior. */
  async function aoVivo(periodo: PeriodoDasBaixas, codigoLoja: number, itens: readonly ItemPreVencido[]) {
    const { inicio, fim } = limites(periodo);
    const base = (await congeladas.daLoja(codigoLoja)).filter((c) => c.ate < inicio).at(-1) ?? null;
    const { baixas, restante } = await doErp(() => baixasDaLoja(cliente(), codigoLoja, itens, { base, ate: fim }));
    return { baixas: baixas.filter((b) => b.venda.data >= inicio), restante };
  }

  return {
    /**
     * Baixas de Pré-vencido de um Closing Period nas Lojas pedidas (todas as que têm Itens, sem `lojas`): as gravadas
     * se ele está fechado, senão ao vivo. Lança `BaixasSemErpError` quando precisa do ERP e ele falha.
     */
    async baixasDoPeriodo(periodo: PeriodoDasBaixas, lojas?: readonly number[]): Promise<BaixaDeVenda<VendaDaLoja>[]> {
      if (periodo.status === "closed") {
        const gravadas = await congeladas.doPeriodo(periodo.id);
        if (gravadas.length > 0) return gravadas.filter((c) => !lojas || lojas.includes(c.codigoLoja)).flatMap((c) => c.baixas);
      }
      const baixas: BaixaDeVenda<VendaDaLoja>[] = [];
      for (const codigoLoja of lojas ?? (await estoque.lojas())) {
        const itens = await estoque.listar(codigoLoja);
        if (itens.length > 0) baixas.push(...(await aoVivo(periodo, codigoLoja, itens)).baixas);
      }
      return baixas;
    },

    /** Restante de agora de cada Item da Loja, a partir do último congelamento. Lança `BaixasSemErpError`. */
    async restante(codigoLoja: number, itens: readonly ItemPreVencido[]): Promise<Record<string, number>> {
      if (itens.length === 0) return {};
      const base = (await congeladas.daLoja(codigoLoja)).at(-1) ?? null;
      return (await doErp(() => baixasDaLoja(cliente(), codigoLoja, itens, { base }))).restante;
    },

    /** O que o fechamento do Período grava: em cada Loja com Itens, as Baixas dele e o Restante no seu fim. Só lê. */
    async congelamento(periodo: PeriodoDasBaixas): Promise<BaixasCongeladas[]> {
      const congeladoEm = new Date().toISOString();
      const resultado: BaixasCongeladas[] = [];
      for (const codigoLoja of await estoque.lojas()) {
        const itens = await estoque.listar(codigoLoja);
        if (itens.length === 0) continue;
        const { baixas, restante } = await aoVivo(periodo, codigoLoja, itens);
        const porItem = Object.fromEntries(itens.map((i) => [i.id, { quantidade: i.quantidade, restante: restante[i.id] ?? i.quantidade }]));
        resultado.push({ periodoId: periodo.id, codigoLoja, ate: limites(periodo).fim, baixas, itens: porItem, congeladoEm });
      }
      return resultado;
    },
  };
}

export type BaixasPreVencidos = ReturnType<typeof baixasPreVencidos>;

const FECHAMENTO_SEM_BAIXAS = "ERP InovaFarma indisponível: não foi possível calcular as Baixas de Pré-vencido, e o Período não pode ser fechado agora. Tente novamente em instantes.";
/** O fechamento consulta as vendas de todas as Lojas com Estoque: mais que os 2 s padrão de um handler. */
const TEMPO_CONGELAMENTO_MS = 120_000;
const MAX_PENDENTES = 100;

export interface CongelamentoBaixasDeps {
  events: Pick<ModuleContext["events"], "before" | "after">;
  periods: { list(): Promise<PeriodoDasBaixas[]> };
  baixas: BaixasPreVencidos;
  congeladas: BaixasCongeladasStore;
}

/**
 * Congela as Baixas no fechamento do Closing Period, como a Apuração (ADR 0007): o `before` calcula (só lê) e recusa o
 * fechamento se o ERP falhar, sem gravar nada; o `after` grava. Reabrir descarta o congelado.
 */
export function registerCongelamentoBaixas({ events, periods, baixas, congeladas }: CongelamentoBaixasDeps): void {
  const periodoDoEvento = async (payload: object) => (await periods.list()).find((p) => p.id === (payload as { periodId?: string }).periodId);
  const pendentes = new Map<string, BaixasCongeladas[]>();

  events.before(
    "closing_period.close",
    async (ctx) => {
      const periodo = await periodoDoEvento(ctx.payload);
      if (!periodo) return;
      try {
        const congelamento = await baixas.congelamento(periodo);
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
      const periodoId = (payload as { periodId?: string }).periodId ?? "";
      const congelamento = pendentes.get(periodoId);
      if (!congelamento) return;
      pendentes.delete(periodoId);
      await congeladas.gravar(periodoId, congelamento);
    },
    { module: "inovafarma" },
  );
  events.after(
    "closing_period.reopen",
    async (payload) => {
      await congeladas.descartar((payload as { periodId?: string }).periodId ?? "");
    },
    { module: "inovafarma" },
  );
}
