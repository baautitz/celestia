import { atingimento as calcularAtingimento, comUnidade, formatarValor, reais, type Indicador, type IndicadorId } from "./indicadores.js";
import type { ParticipanteMeta } from "./metas-store.js";
import { indicadorDoTipo, type DadosTipoMeta, type RegraPremio } from "./tipos-meta.js";

/** O que o Período tem de um Colaborador, somado em todas as Lojas. */
export interface DadosColaborador {
  /** Realizado de cada Indicador de vendas, na unidade do Indicador (R$ em centavos); a Lista de Produtos é a do Tipo de Meta apurado. */
  indicadores: Partial<Record<IndicadorId, number>>;
  /** Descontos das Avaliações do Período, de qualquer Loja. */
  descontosCentavos: number;
}

export interface ResultadoParticipante {
  codigoColaborador: number;
  nome: string;
  /** Alvo na unidade do Indicador (o valor inicial nas Avaliações); null sem Alvo ou pendente. */
  alvo: number | null;
  /** Na unidade do Indicador (o Saldo nas Avaliações). */
  realizado: number;
  /** % Atingido; null sem Alvo ou com o Alvo pendente. */
  atingimento: number | null;
  /** null no Tipo sem Alvo, que nunca é Atingida nem Não atingida. */
  atingida: boolean | null;
  premioCentavos: number;
  /** Resultado na unidade do Indicador e em palavras, como o gestor vê. */
  resultado: string;
}

type TipoApurado = Pick<DadosTipoMeta, "indicador" | "semAlvo" | "regra"> & { lista?: DadosTipoMeta["lista"] };

const nomeCurto = (indicador: Indicador) => indicador.nome.replace(/ %$/, "");
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
    case "faixasPercentuais": {
      const faixa = regra.faixas.filter((f) => pct >= f.atingimento).reduce<{ atingimento: number; percentual: number } | null>((maior, f) => (!maior || f.atingimento > maior.atingimento ? f : maior), null);
      return faixa ? Math.round((regra.valorCentavos * faixa.percentual) / 100) : 0;
    }
    case "percentual":
      if (regra.soSeAtingir && !atingida) return 0;
      return Math.round(((dados.indicadores[regra.indicadorBase] ?? 0) * regra.percentual) / 100);
    case "saldo":
      return Math.round(realizado);
  }
}

/** Realizado, % Atingido e Prêmio de um Participante numa Meta, com o resultado em palavras. */
/** O Prêmio próprio do Participante vale enquanto for do mesmo tipo de regra do Tipo de Meta; senão, vale o do Tipo. */
export const regraDoParticipante = (regra: RegraPremio, participante: Pick<ParticipanteMeta, "premio">): RegraPremio =>
  participante.premio && participante.premio.tipo === regra.tipo ? participante.premio : regra;

export function apurarParticipante(tipo: TipoApurado, participante: ParticipanteMeta, dados: DadosColaborador): ResultadoParticipante {
  const indicador = indicadorDoTipo(tipo);
  const { codigoColaborador, nome } = participante;
  const alvo = tipo.semAlvo ? null : participante.alvo;
  let realizado: number;
  let resultado: string;
  let atingimento: number | null = null;

  if (tipo.indicador === "avaliacoes") {
    const inicial = alvo ?? 0;
    realizado = Math.max(0, inicial - dados.descontosCentavos);
    atingimento = alvo === null ? null : inicial > 0 ? (realizado / inicial) * 100 : 0;
    resultado = alvo === null ? "Valor inicial pendente" : `Saldo ${reais(realizado)} de ${reais(inicial)} · descontos ${reais(dados.descontosCentavos)}`;
  } else {
    const doErp = dados.indicadores[tipo.indicador];
    realizado = doErp ?? 0;
    const atual = `${nomeCurto(indicador)} ${comUnidade(indicador, realizado)}`;
    if (tipo.semAlvo) resultado = `${nomeCurto(indicador)} ${formatarValor(indicador, realizado)}`;
    else if (alvo === null) resultado = `${atual} · Alvo pendente`;
    else if (indicador.direcao === "menor" && (doErp === undefined || (realizado <= 0 && !indicador.zeroEhResultado))) {
      // Sem vendas não há CMV nem Desconto: não é o melhor resultado possível, a Meta não é Atingida.
      atingimento = 0;
      resultado = `${nomeCurto(indicador)} sem vendas · Meta: até ${formatarValor(indicador, alvo)}`;
    } else {
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
    premioCentavos: premio(regraDoParticipante(tipo.regra, participante), atingimento, atingida, realizado, dados),
    resultado,
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
