import { z } from "zod";
import { MIN_BUSCA_PRODUTO } from "./produtos-erp.js";
import { INDICADOR_IDS, formatarValor, indicadorPorId, porcentagem, reais, valorNoAtingimento, type Indicador, type IndicadorId } from "./indicadores.js";

/** Exibição para o Colaborador; o gestor sempre vê tudo. */
export const EXIBICOES = ["atingida", "progresso"] as const;
export type Exibicao = (typeof EXIBICOES)[number];
export const EXIBICAO_LABEL: Record<Exibicao, string> = { atingida: "Atingida / Não atingida", progresso: "Progresso" };

/** Tipo de uma entrada da Lista de Produtos: o que casa com o produto vendido no ERP. */
export const TIPOS_ENTRADA = ["produto", "grupo", "secao", "laboratorio"] as const;
export type TipoEntrada = (typeof TIPOS_ENTRADA)[number];
export const TIPO_ENTRADA_LABEL: Record<TipoEntrada, string> = { produto: "Produto", grupo: "Grupo", secao: "Seção", laboratorio: "Laboratório" };

/** Mínimo de caracteres da busca de cada tipo de entrada no ERP. */
export const MIN_BUSCA_LISTA: Record<TipoEntrada, number> = { produto: MIN_BUSCA_PRODUTO, grupo: 1, secao: 1, laboratorio: 2 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Maior código de um `int` do SQL Server: o código do Grupo, da Seção e do Fabricante. */
const MAX_CODIGO = 2_147_483_647;
/** O id de cada tipo no ERP: `Produto.rowguid` (guid) no Produto; o código (inteiro positivo) do Grupo, da Seção ou do Fabricante nos demais. */
export const idValido = (e: Pick<EntradaLista, "tipo" | "id">) =>
  e.tipo === "produto" ? UUID.test(e.id) : /^[1-9]\d{0,9}$/.test(e.id) && Number(e.id) <= MAX_CODIGO;

/** O que a Lista de Produtos mede: unidades vendidas ou valor vendido (R$, valor líquido). */
export const UNIDADES_LISTA = ["unidades", "reais"] as const;
export type UnidadeLista = (typeof UNIDADES_LISTA)[number];
export const UNIDADE_LISTA_LABEL: Record<UnidadeLista, string> = { unidades: "Unidades vendidas", reais: "Valor vendido (R$)" };

/** Entrada da Lista: o id no ERP e o nome gravado, legível se a entrada sair do ERP. O Laboratório é o Fabricante do ERP. */
export const EntradaLista = z.object({
  tipo: z.enum(TIPOS_ENTRADA),
  id: z.string().trim().min(1).max(64),
  nome: z.string().trim().min(1).max(200),
});
export type EntradaLista = z.infer<typeof EntradaLista>;

/** Lista de Produtos do Tipo de Meta: conjunto de entradas; cada produto vendido conta uma vez dentro da Meta. */
export const ListaTipo = z.object({
  entradas: z.array(EntradaLista).min(1, "Adicione pelo menos uma entrada à Lista.").max(500, "A Lista deve ter no máximo 500 entradas."),
  unidade: z.enum(UNIDADES_LISTA),
});
export type ListaTipo = z.infer<typeof ListaTipo>;

/** Entradas na ordem da tela: por tipo e depois em ordem alfabética. */
export const ordenarEntradas = <E extends Pick<EntradaLista, "tipo" | "nome">>(entradas: readonly E[]): E[] =>
  [...entradas].sort((a, b) => TIPOS_ENTRADA.indexOf(a.tipo) - TIPOS_ENTRADA.indexOf(b.tipo) || a.nome.localeCompare(b.nome, "pt-BR"));

/** Entrada em texto, como o Colaborador e o Audit Log a veem (ex.: "Laboratório EMS"). */
export const descreverEntrada = (e: Pick<EntradaLista, "tipo" | "nome">) => `${TIPO_ENTRADA_LABEL[e.tipo]} ${e.nome}`;

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
  proporcional: "Proporcional ao % Atingido",
  faixas: "Faixas",
  percentual: "Percentual do valor vendido",
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
  /** Só no Indicador Lista de Produtos, e obrigatória nele. */
  lista: ListaTipo.nullable().default(null),
  ativo: z.boolean(),
});
export type DadosTipoMeta = z.infer<typeof DadosTipoMeta>;

export interface TipoMeta extends DadosTipoMeta {
  id: string;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * O Indicador do Tipo de Meta com a unidade de verdade: a Lista de Produtos mede unidades ou R$, conforme a Lista.
 * Use no lugar de `indicadorPorId` sempre que houver o Tipo de Meta.
 */
export function indicadorDoTipo(t: { indicador: IndicadorId; lista?: Pick<ListaTipo, "unidade"> | null }): Indicador {
  const indicador = indicadorPorId(t.indicador);
  return indicador.lista && t.lista?.unidade === "reais" ? { ...indicador, unidade: "reais", valorVendido: true } : indicador;
}

/** Se o Indicador mede uma Lista de Produtos própria do Tipo de Meta. */
export const temLista = (indicador: IndicadorId) => indicadorPorId(indicador).lista === true;

/** Campo do formulário a que um problema do Tipo de Meta se refere, para mostrar o erro ao lado dele. */
export type CampoDoTipo = "semAlvo" | "alvoPadrao" | "lista" | "exibicao" | "regra" | "teto" | "faixas" | "indicadorBase";
export type ProblemaDoTipo = { campo: CampoDoTipo; mensagem: string };

const problemaEm = (campo: CampoDoTipo, mensagem: string): ProblemaDoTipo => ({ campo, mensagem });

/** Regras que dependem de mais de um campo, com o campo a que cada uma se refere; null se o Tipo de Meta é válido. */
export function problemaNoCampo(t: DadosTipoMeta): ProblemaDoTipo | null {
  const indicador = indicadorDoTipo(t);
  const avaliacoes = t.indicador === "avaliacoes";
  if (avaliacoes !== (t.regra.tipo === "saldo")) return problemaEm("regra", "A Meta de Avaliações paga o Saldo, e só ela paga o Saldo.");
  if (avaliacoes && t.semAlvo) return problemaEm("semAlvo", "A Meta de Avaliações precisa do valor inicial.");
  if (temLista(t.indicador) && !t.lista) return problemaEm("lista", "Adicione pelo menos uma entrada à Lista.");
  if (!temLista(t.indicador) && t.lista) return problemaEm("lista", "Só o Indicador Lista de Produtos tem Lista.");
  if (t.lista && !t.lista.entradas.every(idValido)) return problemaEm("lista", "Uma entrada da Lista tem um identificador inválido.");
  if (t.lista && new Set(t.lista.entradas.map((e) => `${e.tipo}:${e.id}`)).size !== t.lista.entradas.length) return problemaEm("lista", "Uma entrada aparece duas vezes na Lista.");
  if (t.regra.tipo === "proporcional" && indicador.direcao === "menor") return problemaEm("regra", `O Proporcional não se aplica a ${indicador.nome}, em que menor é melhor.`);
  if (t.regra.tipo === "proporcional" && t.regra.gatilho !== null && t.regra.teto !== null && t.regra.gatilho >= t.regra.teto)
    return problemaEm("teto", "O Gatilho deve ser menor que o Teto.");
  if (t.regra.tipo === "percentual") {
    // A Lista de Produtos só é base do Percentual no próprio Tipo de Meta de Lista, e só em R$.
    const base = t.regra.indicadorBase === t.indicador ? indicador : temLista(t.regra.indicadorBase) ? null : indicadorPorId(t.regra.indicadorBase);
    if (!base?.valorVendido) return problemaEm("indicadorBase", "O Percentual se aplica a um Indicador de valor vendido em R$.");
  }
  if (t.regra.tipo === "faixas" && new Set(t.regra.faixas.map((f) => f.atingimento)).size !== t.regra.faixas.length) return problemaEm("faixas", "Duas Faixas não podem ter o mesmo % Atingido.");
  if (t.semAlvo) {
    if (t.regra.tipo !== "percentual" || t.regra.soSeAtingir) return problemaEm("regra", "Um Tipo de Meta sem Alvo só paga o Percentual, sem depender de atingir.");
    if (t.regra.indicadorBase !== t.indicador) return problemaEm("indicadorBase", "Um Tipo de Meta sem Alvo paga o Percentual sobre o próprio Indicador.");
    if (t.exibicao !== "progresso") return problemaEm("exibicao", "Um Tipo de Meta sem Alvo não mostra Atingida / Não atingida: use a Exibição Progresso.");
    if (t.alvoPadrao !== null) return problemaEm("alvoPadrao", "Um Tipo de Meta sem Alvo não tem Alvo padrão.");
  }
  return null;
}

/** Regras que dependem de mais de um campo; null se o Tipo de Meta é válido. */
export const problemaDoTipo = (t: DadosTipoMeta): string | null => problemaNoCampo(t)?.mensagem ?? null;

/** Ponto da regra: na unidade do Indicador quando há Alvo padrão; senão, em % de Atingimento. */
const limiar = (indicador: Indicador, alvo: number | null, pct: number) =>
  alvo === null
    ? porcentagem(pct)
    : `${indicador.direcao === "menor" ? "até" : "a partir de"} ${formatarValor(indicador, valorNoAtingimento(indicador, alvo, pct))}`;

/** Prévia da regra do Prêmio em linguagem natural, na unidade do Indicador (ex.: "CMV % até 30% paga R$ 100,00"). */
export function descreverPremio(t: Pick<DadosTipoMeta, "indicador" | "regra" | "alvoPadrao"> & { lista?: DadosTipoMeta["lista"] }): string {
  const indicador = indicadorDoTipo(t);
  const alvo = t.alvoPadrao;
  const r = t.regra;
  switch (r.tipo) {
    case "fixo":
      return alvo === null ? `Atingir o Alvo paga ${reais(r.valorCentavos)}` : `${indicador.nome} ${limiar(indicador, alvo, 100)} paga ${reais(r.valorCentavos)}`;
    case "faixas": {
      const faixas = [...r.faixas].sort((a, b) => a.atingimento - b.atingimento).map((f) => `${limiar(indicador, alvo, f.atingimento)}${alvo === null ? " atingido" : ""} paga ${reais(f.valorCentavos)}`);
      return alvo === null ? faixas.join(" · ") : `${indicador.nome} ${faixas.join(" · ")}`;
    }
    case "proporcional": {
      const ponto = (pct: number) => (alvo === null ? `${porcentagem(pct)} atingido` : formatarValor(indicador, valorNoAtingimento(indicador, alvo, pct)));
      const partes = [`${indicador.nome}: ${reais(r.valorCentavos)} ${alvo === null ? "a" : "ao chegar a"} ${ponto(100)}, proporcional ao % Atingido`];
      if (r.gatilho !== null) partes.push(`nada abaixo de ${ponto(r.gatilho)}`);
      if (r.teto !== null) partes.push(`no máximo ${reais(Math.round((r.valorCentavos * r.teto) / 100))} a partir de ${ponto(r.teto)}`);
      return partes.join(" · ");
    }
    case "percentual":
      return `Paga ${porcentagem(r.percentual)} ${temLista(r.indicadorBase) ? "do valor vendido da Lista de Produtos" : `do ${indicadorPorId(r.indicadorBase).nome}`}${r.soSeAtingir ? ", se atingir o Alvo" : ""}`;
    case "saldo":
      return `Começa com ${alvo === null ? "o valor inicial" : reais(alvo)}, desconta as Avaliações do Período e paga o Saldo`;
  }
}

export type { IndicadorId };
