/** Se o Atingimento cresce com o Realizado (`maior`) ou cai (`menor`, como o CMV %). */
export type Direcao = "maior" | "menor";

/**
 * Unidade dos valores do Indicador (Realizado e Alvo): `percentual` em pontos (30 = 30%),
 * `reais` em centavos e `quantidade` em unidades.
 */
export type Unidade = "percentual" | "reais" | "quantidade";

export interface Indicador {
  id: string;
  nome: string;
  direcao: Direcao;
  unidade: Unidade;
  /** Quando menor é melhor e zero é o melhor resultado (ex.: Desconto), não falta de vendas (ex.: CMV). */
  zeroEhResultado?: boolean;
  /** Valor vendido em R$: pode ser Sem Alvo e base do Percentual. */
  valorVendido?: boolean;
  /** Nome da unidade nas quantidades (ex.: "40 incentivos"); sem ele, "un.". */
  substantivo?: string;
  /** O Tipo de Meta define o que é medido numa Lista de Produtos própria. */
  lista?: boolean;
}

type Extras = Partial<Pick<Indicador, "direcao" | "zeroEhResultado" | "valorVendido" | "substantivo" | "lista">>;

const indicador = <const I extends string>(id: I, nome: string, unidade: Unidade, extras: Extras = {}) => ({
  id,
  nome,
  unidade,
  direcao: "maior" as Direcao,
  ...extras,
});

const VENDIDO = { valorVendido: true } as const;

/** Indicadores fixos do Plugin: o cliente não cria Indicador, só escolhe um destes no Tipo de Meta. */
export const INDICADORES = [
  indicador("venda-liquida", "Venda Líquida", "reais", VENDIDO),
  indicador("desconto-percent", "Desconto %", "percentual", { direcao: "menor", zeroEhResultado: true }),
  indicador("desconto-valor", "Desconto em R$", "reais", { direcao: "menor", zeroEhResultado: true }),
  indicador("cmv", "CMV %", "percentual", { direcao: "menor" }),
  indicador("ticket-medio", "Ticket Médio", "reais"),
  indicador("foco-qtd", "Qtd. Total Foco", "quantidade"),
  indicador("foco-valor", "Valor Total Foco", "reais", VENDIDO),
  indicador("vitaminas-qtd", "Qtd. Vitaminas", "quantidade", { substantivo: "vitaminas" }),
  indicador("vitaminas-valor", "Valor Vitaminas", "reais", VENDIDO),
  indicador("genericos-qtd", "Qtd. Genéricos", "quantidade", { substantivo: "genéricos" }),
  indicador("genericos-valor", "Valor Genéricos", "reais", VENDIDO),
  indicador("similares-qtd", "Qtd. Similares", "quantidade", { substantivo: "similares" }),
  indicador("similares-valor", "Valor Similares", "reais", VENDIDO),
  indicador("incentivos-qtd", "Qtd. Incentivos", "quantidade", { substantivo: "incentivos" }),
  indicador("incentivos-valor", "Valor Incentivos", "reais", VENDIDO),
  indicador("vendas-cadastro-qtd", "Qtd. de Vendas com Cadastro", "quantidade", { substantivo: "vendas" }),
  indicador("vendas-cadastro-percent", "% de Vendas com Cadastro", "percentual"),
  indicador("pre-vencidos", "Pré-vencidos vendidos", "quantidade", { substantivo: "pré-vencidos" }),
  indicador("lista-produtos", "Lista de Produtos", "quantidade", { lista: true }),
  indicador("avaliacoes", "Avaliações (Saldo)", "reais"),
] as const satisfies readonly Indicador[];

export type IndicadorId = (typeof INDICADORES)[number]["id"];

export const INDICADOR_IDS = INDICADORES.map((i) => i.id) as [IndicadorId, ...IndicadorId[]];

export const indicadorPorId = (id: IndicadorId): Indicador => INDICADORES.find((i) => i.id === id)!;

/**
 * Atingimento em %: Realizado ÷ Alvo; quando menor é melhor, Alvo ÷ Realizado (ficar abaixo do Alvo passa de 100%).
 * Quando menor é melhor, Realizado zero é falta de vendas, não o melhor resultado: Atingimento 0.
 * A interface nunca mostra essa conta.
 */
export function atingimento(indicador: Indicador, realizado: number, alvo: number): number {
  if (indicador.direcao === "menor") return realizado > 0 ? (alvo / realizado) * 100 : indicador.zeroEhResultado ? Infinity : 0;
  return alvo > 0 ? (realizado / alvo) * 100 : 0;
}

/** Valor do Indicador que dá o Atingimento pedido, para mostrar as regras na unidade do Indicador. */
export const valorNoAtingimento = (indicador: Indicador, alvo: number, pct: number): number =>
  indicador.direcao === "menor" ? alvo / (pct / 100) : alvo * (pct / 100);

const numero = (n: number, max = 2) => n.toLocaleString("pt-BR", { maximumFractionDigits: max });

/** R$ a partir de centavos, com espaço comum (sem o espaço fino do Intl) para caber em texto e Log Entry. */
export const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");

export const porcentagem = (pct: number) => `${numero(pct)}%`;

/** Um valor na unidade do Indicador, como a tela mostra (30%, R$ 50,00, 200). */
export function formatarValor(indicador: Indicador, valor: number): string {
  switch (indicador.unidade) {
    case "percentual":
      return porcentagem(valor);
    case "reais":
      return reais(Math.round(valor));
    default:
      return numero(valor);
  }
}

/** Valor na unidade do Indicador, com "un." nas quantidades (ex.: "40 un.", "R$ 50,00"). */
export const comUnidade = (indicador: Indicador, valor: number) => `${formatarValor(indicador, valor)}${indicador.unidade === "quantidade" ? " un." : ""}`;
