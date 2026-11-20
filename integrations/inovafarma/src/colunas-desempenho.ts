import { z } from "zod";
import { EntradaLista, descreverEntrada, idValido, ordenarEntradas } from "./tipos-meta.js";

/**
 * Coluna do Desempenho de Vendas montada pelo cliente: soma as vendas dos produtos que casam com as entradas (Produto,
 * Grupo, Seção, Laboratório) e/ou com as entradas das colunas da `uniao`. As condições vão unidas por `OR` sobre o
 * produto vendido, então um produto em mais de uma entrada conta uma vez (é assim que o Total Foco não soma em dobro).
 */
/** O que a coluna mostra na tabela: unidades, valor vendido, participação nas vendas, CMV (R$ e %) e valor por venda. */
export const MEDIDAS_COLUNA = ["quantidade", "valor", "participacaoPercent", "cmv", "cmvPercent", "ticketMedio"] as const;
export type MedidaColuna = (typeof MEDIDAS_COLUNA)[number];
export const MEDIDA_LABEL: Record<MedidaColuna, string> = {
  quantidade: "Qtde",
  valor: "Valor (R$)",
  participacaoPercent: "Vendas (%)",
  cmv: "CMV (R$)",
  cmvPercent: "CMV (%)",
  ticketMedio: "Ticket (R$)",
};
/** Sem escolha, a coluna mostra as medidas que já mostrava. */
export const MEDIDAS_PADRAO: MedidaColuna[] = ["quantidade", "valor", "participacaoPercent", "cmvPercent", "ticketMedio"];

export const DadosColunaDesempenho = z.object({
  nome: z.string().trim().min(1, "Informe o nome da coluna.").max(40, "O nome deve ter no máximo 40 caracteres."),
  entradas: z.array(EntradaLista).max(500, "A coluna deve ter no máximo 500 entradas."),
  uniao: z.array(z.string().min(1)).max(50),
  medidas: z.array(z.enum(MEDIDAS_COLUNA)).min(1, "Escolha pelo menos uma medida.").default(MEDIDAS_PADRAO),
});
export type DadosColunaDesempenho = z.infer<typeof DadosColunaDesempenho>;

export interface ColunaDesempenho extends DadosColunaDesempenho {
  id: string;
  ordem: number;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

/** Regras que dependem de mais de um campo e das outras colunas; null se a coluna é válida. */
export function problemaDaColuna(dados: DadosColunaDesempenho, outras: readonly Pick<ColunaDesempenho, "id" | "uniao">[], id?: string): string | null {
  if (new Set(dados.medidas).size !== dados.medidas.length) return "Uma medida aparece duas vezes.";
  if (dados.entradas.length === 0 && dados.uniao.length === 0) return "Adicione pelo menos uma entrada ou una outra coluna.";
  if (!dados.entradas.every(idValido)) return "Uma entrada da coluna tem um identificador inválido.";
  if (new Set(dados.entradas.map((e) => `${e.tipo}:${e.id}`)).size !== dados.entradas.length) return "Uma entrada aparece duas vezes na coluna.";
  if (new Set(dados.uniao).size !== dados.uniao.length) return "Uma coluna aparece duas vezes na união.";
  for (const membro of dados.uniao) {
    const coluna = outras.find((o) => o.id === membro);
    if (!coluna || membro === id) return "A união usa uma coluna que não existe.";
    if (coluna.uniao.length > 0) return "Uma coluna da união não pode ser, ela mesma, uma união.";
  }
  return null;
}

/** As colunas que usam esta numa união: ela não pode ser removida nem virar uma união enquanto isso valer. */
export const usadaEmUniao = (id: string, todas: readonly Pick<ColunaDesempenho, "id" | "nome" | "uniao">[]) => todas.filter((c) => c.uniao.includes(id));

/** A coluna em texto, como o Audit Log a vê (ex.: "Grupo VITAMINAS; união com Genéricos"). */
export function descreverColuna(c: Pick<ColunaDesempenho, "entradas" | "uniao">, todas: readonly Pick<ColunaDesempenho, "id" | "nome">[]): string {
  const partes = ordenarEntradas(c.entradas).map(descreverEntrada);
  const nomes = c.uniao.map((id) => todas.find((o) => o.id === id)?.nome ?? id);
  if (nomes.length) partes.push(`união com ${nomes.join(", ")}`);
  // Começa com maiúscula também quando só há união ("União com Vitaminas, Genéricos").
  const texto = partes.join("; ");
  return texto.charAt(0).toLocaleUpperCase("pt-BR") + texto.slice(1);
}
