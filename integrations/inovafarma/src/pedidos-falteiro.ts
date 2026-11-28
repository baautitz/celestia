import { z } from "zod";
import { Codigo } from "./metas-comum.js";

const MAX_QUANTIDADE = 1_000_000;
export const MAX_OBSERVACAO_FALTEIRO = 280;

const QuantidadeFalteiro = z
  .number({ error: "A quantidade deve ser inteira." })
  .int("A quantidade deve ser inteira.")
  .positive("A quantidade desejada deve ser maior que zero.")
  .max(MAX_QUANTIDADE, "Quantidade acima do limite.")
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const ObservacaoFalteiro = z
  .string()
  .trim()
  .max(MAX_OBSERVACAO_FALTEIRO, `A observação deve ter no máximo ${MAX_OBSERVACAO_FALTEIRO} caracteres.`)
  .nullable()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

export const EdicaoFalteiro = z.object({
  codigoLoja: Codigo.nullable().optional().transform((v) => v ?? null),
  quantidade: QuantidadeFalteiro,
  observacao: ObservacaoFalteiro,
});
export type EdicaoFalteiro = z.infer<typeof EdicaoFalteiro>;

export const DadosFalteiro = EdicaoFalteiro.extend({
  produtoId: z.string().min(1, "Informe o produto.").max(36),
});
export type DadosFalteiro = z.infer<typeof DadosFalteiro>;

export interface Falta {
  id: string;
  produtoId: string;
  /** Código da Loja no ERP; `null` quando a falta vale para todas as Lojas. */
  codigoLoja: number | null;
  quantidade: number | null;
  observacao: string | null;
  criadoPorId: string;
  criadoPorNome: string;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}
