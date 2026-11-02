import { z } from "zod";
import { INDICADOR_IDS, formatarValor, indicadorPorId, porcentagem, reais, valorNoAtingimento, type Indicador, type IndicadorId } from "./indicadores.js";

/** Exibição para o Colaborador; o gestor sempre vê tudo. */
export const EXIBICOES = ["atingida", "progresso", "contagem"] as const;
export type Exibicao = (typeof EXIBICOES)[number];
export const EXIBICAO_LABEL: Record<Exibicao, string> = { atingida: "Atingida / Não atingida", progresso: "Progresso", contagem: "Contagem" };

const Centavos = z.number().int().min(1, "Informe o valor do Prêmio.");
const Pct = z.number().positive();

/** Regra do Prêmio. Valores em R$ em centavos; Gatilho, Teto e Faixas em % de Atingimento. */
export const RegraPremio = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("fixo"), valorCentavos: Centavos }),
  z.object({ tipo: z.literal("proporcional"), valorCentavos: Centavos, gatilho: Pct.nullable(), teto: Pct.nullable() }),
  z.object({
    tipo: z.literal("faixas"),
    faixas: z.array(z.object({ atingimento: Pct, valorCentavos: Centavos })).min(1, "Informe ao menos uma Faixa.").max(20),
  }),
  z.object({ tipo: z.literal("percentual"), percentual: Pct.max(100), indicadorBase: z.enum(INDICADOR_IDS), soSeAtingir: z.boolean() }),
  /** Meta de Avaliações: o Prêmio é o Saldo. */
  z.object({ tipo: z.literal("saldo") }),
]);
export type RegraPremio = z.infer<typeof RegraPremio>;
export type TipoRegra = RegraPremio["tipo"];
export const REGRA_LABEL: Record<TipoRegra, string> = {
  fixo: "Fixo se atingir",
  proporcional: "Proporcional ao Atingimento",
  faixas: "Faixas",
  percentual: "Percentual de um Indicador em R$",
  saldo: "Saldo das Avaliações",
};

export const DadosTipoMeta = z.object({
  nome: z.string().trim().min(1, "Informe o nome do Tipo de Meta.").max(80, "O nome deve ter no máximo 80 caracteres."),
  indicador: z.enum(INDICADOR_IDS),
  exibicao: z.enum(EXIBICOES),
  mostrarPremio: z.boolean(),
  /** Comissão pura: só Percentual, nunca Atingida nem Não atingida. */
  semAlvo: z.boolean(),
  regra: RegraPremio,
  /** Na unidade do Indicador (R$ em centavos). Na Meta de Avaliações, é o valor inicial. */
  alvoPadrao: z.number().positive("O Alvo padrão deve ser maior que zero.").nullable(),
  ativo: z.boolean(),
});
export type DadosTipoMeta = z.infer<typeof DadosTipoMeta>;

export interface TipoMeta extends DadosTipoMeta {
  id: string;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

/** Regras que dependem de mais de um campo; null se o Tipo de Meta é válido. */
export function problemaDoTipo(t: DadosTipoMeta): string | null {
  const indicador = indicadorPorId(t.indicador);
  const avaliacoes = t.indicador === "avaliacoes";
  if (avaliacoes !== (t.regra.tipo === "saldo")) return "A Meta de Avaliações paga o Saldo, e só ela paga o Saldo.";
  if (avaliacoes && t.semAlvo) return "A Meta de Avaliações precisa do valor inicial.";
  if (t.exibicao === "contagem" && t.indicador !== "lista-produtos") return "A Contagem só se aplica à Lista de Produtos.";
  if (t.indicador === "lista-produtos" && t.alvoPadrao !== null) return "A Lista de Produtos não tem Alvo padrão: as quantidades ficam na Meta.";
  if (t.regra.tipo === "proporcional" && indicador.direcao === "menor") return `O Proporcional não se aplica a ${indicador.nome}, em que menor é melhor.`;
  if (t.regra.tipo === "proporcional" && t.regra.gatilho !== null && t.regra.teto !== null && t.regra.gatilho >= t.regra.teto)
    return "O Gatilho deve ser menor que o Teto.";
  if (t.regra.tipo === "percentual") {
    const base = indicadorPorId(t.regra.indicadorBase);
    if (base.unidade !== "reais" || base.id === "avaliacoes" || base.id === "ticket-medio") return "O Percentual se aplica a um Indicador de valor vendido em R$.";
  }
  if (t.regra.tipo === "faixas" && new Set(t.regra.faixas.map((f) => f.atingimento)).size !== t.regra.faixas.length) return "Duas Faixas não podem ter o mesmo Atingimento.";
  if (t.semAlvo) {
    if (t.regra.tipo !== "percentual" || t.regra.soSeAtingir) return "Um Tipo de Meta sem Alvo só paga o Percentual, sem depender de atingir.";
    if (t.exibicao !== "progresso") return "Um Tipo de Meta sem Alvo não mostra Atingida / Não atingida: use a Exibição Progresso.";
    if (t.alvoPadrao !== null) return "Um Tipo de Meta sem Alvo não tem Alvo padrão.";
  }
  return null;
}

/** Ponto da regra: na unidade do Indicador quando há Alvo padrão; senão, em % de Atingimento. */
const limiar = (indicador: Indicador, alvo: number | null, pct: number) =>
  alvo === null
    ? porcentagem(pct)
    : `${indicador.direcao === "menor" ? "até" : "a partir de"} ${formatarValor(indicador, valorNoAtingimento(indicador, alvo, pct))}`;

/** Prévia da regra do Prêmio em linguagem natural, na unidade do Indicador (ex.: "CMV % até 30% paga R$ 100,00"). */
export function descreverPremio(t: Pick<DadosTipoMeta, "indicador" | "regra" | "alvoPadrao">): string {
  const indicador = indicadorPorId(t.indicador);
  const alvo = t.alvoPadrao;
  const r = t.regra;
  switch (r.tipo) {
    case "fixo":
      return alvo === null ? `Atingir o Alvo paga ${reais(r.valorCentavos)}` : `${indicador.nome} ${limiar(indicador, alvo, 100)} paga ${reais(r.valorCentavos)}`;
    case "faixas": {
      const faixas = [...r.faixas].sort((a, b) => a.atingimento - b.atingimento).map((f) => `${limiar(indicador, alvo, f.atingimento)} paga ${reais(f.valorCentavos)}`);
      return `${alvo === null ? "Atingimento de" : indicador.nome} ${faixas.join(" · ")}`;
    }
    case "proporcional": {
      const ponto = (pct: number) => (alvo === null ? `${porcentagem(pct)} de Atingimento` : formatarValor(indicador, valorNoAtingimento(indicador, alvo, pct)));
      const partes = [`${indicador.nome}: ${reais(r.valorCentavos)} ao chegar a ${ponto(100)}, proporcional ao Atingimento`];
      if (r.gatilho !== null) partes.push(`nada abaixo de ${ponto(r.gatilho)}`);
      if (r.teto !== null) partes.push(`no máximo ${reais(Math.round((r.valorCentavos * r.teto) / 100))} a partir de ${ponto(r.teto)}`);
      return partes.join(" · ");
    }
    case "percentual":
      return `Paga ${porcentagem(r.percentual)} do ${indicadorPorId(r.indicadorBase).nome}${r.soSeAtingir ? ", se atingir o Alvo" : ""}`;
    case "saldo":
      return `Começa com ${alvo === null ? "o valor inicial" : reais(alvo)}, desconta as Avaliações do Período e paga o Saldo`;
  }
}

export type { IndicadorId };
