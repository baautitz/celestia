import { z } from "zod";
import { Codigo, DiaDoCalendario } from "./metas-comum.js";
import { EntradaLista, idValido } from "./tipos-meta.js";

/** Regra de Limite: o que o Limite de Compras controla (permanente, reaproveitada a cada vigência). */
export const DadosRegraLimite = z.object({
  nome: z.string().trim().min(1, "Informe o nome da Regra de Limite.").max(80, "O nome deve ter no máximo 80 caracteres."),
  /** A Lista de Produtos controlada. */
  entradas: z
    .array(EntradaLista.refine(idValido, "Uma entrada da Lista de Produtos tem um identificador inválido."))
    .min(1, "Adicione pelo menos uma entrada à Lista.")
    .max(500, "A Lista deve ter no máximo 500 entradas."),
  /** Códigos das distribuidoras no ERP; vazio: todas. */
  fornecedores: z
    .array(Codigo)
    .max(100, "Distribuidoras demais na Regra.")
    .refine((c) => new Set(c).size === c.length, "Distribuidora repetida."),
});
export type DadosRegraLimite = z.infer<typeof DadosRegraLimite>;

export interface RegraLimite extends DadosRegraLimite {
  id: string;
  version: number;
}

const ValorCentavos = z.number().int().min(1, "Informe o valor do Limite.").max(100_000_000_000, "Valor acima do máximo.");

/** `todas`: um saldo único somando as Lojas; `porLoja`: um saldo para cada Loja informada. */
export const Distribuicao = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("todas"), valorCentavos: ValorCentavos }),
  z.object({
    tipo: z.literal("porLoja"),
    lojas: z
      .array(z.object({ codigoLoja: Codigo, valorCentavos: ValorCentavos }))
      .min(1, "Informe o valor de ao menos uma Loja.")
      .max(500, "Lojas demais.")
      .refine((l) => new Set(l.map((x) => x.codigoLoja)).size === l.length, "Loja repetida."),
  }),
]);
export type Distribuicao = z.infer<typeof Distribuicao>;

const Dia = DiaDoCalendario("Informe a data no formato AAAA-MM-DD.");

/** Valor do Limite: quanto se pode comprar de uma Regra em uma vigência (as duas datas inclusas). */
export const DadosValorLimite = z
  .object({ regraId: z.string().min(1, "Informe a Regra de Limite.").max(60), inicio: Dia, fim: Dia, distribuicao: Distribuicao })
  .refine((v) => v.inicio <= v.fim, { error: "O fim da vigência não pode ser anterior ao início.", path: ["fim"] });
export type DadosValorLimite = z.infer<typeof DadosValorLimite>;

export interface ValorLimite extends DadosValorLimite {
  id: string;
  version: number;
}
