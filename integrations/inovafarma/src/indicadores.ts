/** Se o Atingimento cresce com o Realizado (`maior`) ou cai (`menor`, como o CMV %). */
export type Direcao = "maior" | "menor";

/**
 * Unidade dos valores do Indicador (Realizado e Alvo): `percentual` em pontos (30 = 30%),
 * `reais` em centavos, `quantidade` em unidades e `produtos` em produtos batidos da Lista de Produtos.
 */
export type Unidade = "percentual" | "reais" | "quantidade" | "produtos";

export interface Indicador {
  id: string;
  nome: string;
  direcao: Direcao;
  unidade: Unidade;
}

const indicador = <const I extends string>(id: I, nome: string, unidade: Unidade, direcao: Direcao = "maior") => ({ id, nome, direcao, unidade });

/** Indicadores fixos do Plugin: o cliente não cria Indicador, só escolhe um destes no Tipo de Meta. */
export const INDICADORES = [
  indicador("cmv", "CMV %", "percentual", "menor"),
  indicador("ticket-medio", "Ticket Médio", "reais"),
  indicador("foco-qtd", "Qtd. Total Foco", "quantidade"),
  indicador("foco-valor", "Valor Total Foco", "reais"),
  indicador("vitaminas-qtd", "Qtd. Vitaminas", "quantidade"),
  indicador("vitaminas-valor", "Valor Vitaminas", "reais"),
  indicador("genericos-qtd", "Qtd. Genéricos", "quantidade"),
  indicador("genericos-valor", "Valor Genéricos", "reais"),
  indicador("similares-qtd", "Qtd. Similares", "quantidade"),
  indicador("similares-valor", "Valor Similares", "reais"),
  indicador("incentivos-qtd", "Qtd. Incentivos", "quantidade"),
  indicador("incentivos-valor", "Valor Incentivos", "reais"),
  indicador("vendas-cadastro-qtd", "Qtd. de Vendas com Cadastro", "quantidade"),
  indicador("vendas-cadastro-percent", "% de Vendas com Cadastro", "percentual"),
  indicador("pre-vencidos", "Pré-vencidos vendidos", "quantidade"),
  indicador("lista-produtos", "Lista de Produtos", "produtos"),
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
  if (indicador.direcao === "menor") return realizado > 0 ? (alvo / realizado) * 100 : 0;
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
    case "produtos":
      return `${numero(valor, 0)} produtos`;
    default:
      return numero(valor);
  }
}
