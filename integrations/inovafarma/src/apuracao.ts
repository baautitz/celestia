import { atingimento as calcularAtingimento, formatarValor, indicadorPorId, reais, type Indicador, type IndicadorId } from "./indicadores.js";
import type { ListaProdutos, ParticipanteMeta } from "./metas-store.js";
import type { DadosTipoMeta, RegraPremio } from "./tipos-meta.js";

/** O que o Período tem de um Colaborador, somado em todas as Lojas. */
export interface DadosColaborador {
  /** Realizado de cada Indicador de vendas, na unidade do Indicador (R$ em centavos). */
  indicadores: Partial<Record<IndicadorId, number>>;
  /** Quantidade vendida por produto (`Produto.rowguid`), para a Lista de Produtos. */
  produtos: Record<string, number>;
  /** Descontos das Avaliações do Período, de qualquer Loja. */
  descontosCentavos: number;
}

export interface ResultadoParticipante {
  codigoColaborador: number;
  nome: string;
  /** Alvo na unidade do Indicador: o valor inicial nas Avaliações e o mínimo de produtos na Lista; null sem Alvo ou pendente. */
  alvo: number | null;
  /** Na unidade do Indicador: o Saldo nas Avaliações e os produtos batidos na Lista. */
  realizado: number;
  /** % de Atingimento; null sem Alvo ou com o Alvo pendente. */
  atingimento: number | null;
  /** null no Tipo sem Alvo, que nunca é Atingida nem Não atingida. */
  atingida: boolean | null;
  premioCentavos: number;
  /** Resultado na unidade do Indicador e em palavras, como o gestor vê. */
  resultado: string;
  /** Na Lista de Produtos: quantos produtos a Lista tem. */
  totalProdutos?: number;
}

type TipoApurado = Pick<DadosTipoMeta, "indicador" | "semAlvo" | "regra">;

const nomeCurto = (indicador: Indicador) => indicador.nome.replace(/ %$/, "");
const comUnidade = (indicador: Indicador, valor: number) => `${formatarValor(indicador, valor)}${indicador.unidade === "quantidade" ? " un." : ""}`;
/** Diferença entre dois valores do Indicador: em pontos percentuais quando o Indicador é %. */
export const diferenca = (indicador: Indicador, valor: number) =>
  indicador.unidade === "percentual" ? `${formatarValor({ ...indicador, unidade: "quantidade" }, valor)} p.p.` : formatarValor(indicador, valor);

function premio(regra: RegraPremio, atingimento: number | null, atingida: boolean | null, realizado: number, dados: DadosColaborador): number {
  const pct = atingimento ?? 0;
  switch (regra.tipo) {
    case "fixo":
      return atingida ? regra.valorCentavos : 0;
    case "proporcional":
      if (regra.gatilho !== null && pct < regra.gatilho) return 0;
      return Math.round((regra.valorCentavos * Math.min(pct, regra.teto ?? Infinity)) / 100);
    case "faixas":
      return regra.faixas.filter((f) => pct >= f.atingimento).reduce((maior, f) => (f.atingimento > maior.atingimento ? f : maior), { atingimento: -1, valorCentavos: 0 }).valorCentavos;
    case "percentual":
      if (regra.soSeAtingir && !atingida) return 0;
      return Math.round(((dados.indicadores[regra.indicadorBase] ?? 0) * regra.percentual) / 100);
    case "saldo":
      return Math.round(realizado);
  }
}

/** Realizado, Atingimento e Prêmio de um Participante numa Meta, com o resultado em palavras. */
export function apurarParticipante(tipo: TipoApurado, lista: ListaProdutos | null, participante: ParticipanteMeta, dados: DadosColaborador): ResultadoParticipante {
  const indicador = indicadorPorId(tipo.indicador);
  const { codigoColaborador, nome } = participante;
  let alvo = tipo.semAlvo ? null : participante.alvo;
  let realizado: number;
  let resultado: string;
  let atingimento: number | null = null;
  let totalProdutos: number | undefined;

  if (tipo.indicador === "lista-produtos") {
    const produtos = lista?.produtos ?? [];
    const quantidade = (produtoId: string, padrao: number) =>
      lista?.ajustes.find((a) => a.codigoColaborador === codigoColaborador && a.produtoId === produtoId)?.quantidade ?? padrao;
    realizado = produtos.filter((p) => (dados.produtos[p.produtoId] ?? 0) >= quantidade(p.produtoId, p.quantidade)).length;
    totalProdutos = produtos.length;
    alvo = lista?.minimo ?? produtos.length;
    atingimento = alvo > 0 ? (realizado / alvo) * 100 : 0;
    resultado = `${realizado} de ${produtos.length} produtos batidos · mínimo ${alvo}`;
  } else if (tipo.indicador === "avaliacoes") {
    const inicial = alvo ?? 0;
    realizado = Math.max(0, inicial - dados.descontosCentavos);
    atingimento = alvo === null ? null : inicial > 0 ? (realizado / inicial) * 100 : 0;
    resultado = alvo === null ? "Valor inicial pendente" : `Saldo ${reais(realizado)} de ${reais(inicial)} · descontos ${reais(dados.descontosCentavos)}`;
  } else {
    realizado = dados.indicadores[tipo.indicador] ?? 0;
    const atual = `${nomeCurto(indicador)} ${comUnidade(indicador, realizado)}`;
    if (tipo.semAlvo) resultado = `${nomeCurto(indicador)} ${formatarValor(indicador, realizado)}`;
    else if (alvo === null) resultado = `${atual} · Alvo pendente`;
    else {
      atingimento = calcularAtingimento(indicador, realizado, alvo);
      const folga = Math.abs(realizado - alvo);
      resultado =
        indicador.direcao === "menor"
          ? `${nomeCurto(indicador)} ${formatarValor(indicador, realizado)} · Meta: até ${formatarValor(indicador, alvo)} · ${realizado <= alvo ? `✓ ${diferenca(indicador, folga)} abaixo` : `✗ ${diferenca(indicador, folga)} acima`}`
          : `${nomeCurto(indicador)} ${formatarValor(indicador, realizado)} de ${comUnidade(indicador, alvo)} · ${realizado >= alvo ? (folga > 0 ? `✓ ${diferenca(indicador, folga)} acima` : "✓ atingida") : `faltam ${diferenca(indicador, folga)}`}`;
    }
  }

  const atingida = tipo.semAlvo ? null : tipo.indicador === "avaliacoes" ? realizado > 0 : atingimento !== null && atingimento >= 100;
  return {
    codigoColaborador,
    nome,
    alvo,
    realizado,
    atingimento,
    atingida,
    premioCentavos: premio(tipo.regra, atingimento, atingida, realizado, dados),
    resultado,
    ...(totalProdutos === undefined ? {} : { totalProdutos }),
  };
}

/** Total de Prêmios de cada Colaborador no Período, na ordem em que aparece pela primeira vez. */
export function totaisPorColaborador(linhas: Pick<ResultadoParticipante, "codigoColaborador" | "nome" | "premioCentavos">[]) {
  const totais = new Map<number, { codigoColaborador: number; nome: string; premioCentavos: number }>();
  for (const l of linhas) {
    const t = totais.get(l.codigoColaborador) ?? { codigoColaborador: l.codigoColaborador, nome: l.nome, premioCentavos: 0 };
    t.premioCentavos += l.premioCentavos;
    totais.set(l.codigoColaborador, t);
  }
  return [...totais.values()];
}
