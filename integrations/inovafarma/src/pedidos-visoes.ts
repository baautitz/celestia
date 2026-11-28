import { z } from "zod";
import { EntradaLista, idValido } from "./tipos-meta.js";

export const MODO_FALTEIRO = ["incluir", "somente", "excluir"] as const;
export type ModoFalteiro = (typeof MODO_FALTEIRO)[number];

/**
 * Visão salva do Lançamento de Pedidos: os filtros que o comprador repete (Lojas, Filtro de produtos,
 * "apenas com mínimo", modo do Falteiro e "incluir sem venda"). Nunca guarda a data: ela sempre abre no padrão (ontem). Privada do Usuário.
 */
export const DadosVisaoPedidos = z
  .object({
    nome: z.string().trim().min(1, "Informe o nome da visão.").max(60, "O nome deve ter no máximo 60 caracteres."),
    lojas: z.array(z.number().int().min(1)).max(200),
    /** O "Filtro de produtos": Produtos, Grupos, Seções e Laboratórios (união). */
    entradas: z.array(EntradaLista.refine(idValido, "Uma entrada do Filtro de produtos tem um identificador inválido.")).max(500),
    apenasComMinimo: z.boolean(),
    falteiro: z.enum(MODO_FALTEIRO).default("incluir"),
    incluirSemVenda: z.boolean().default(false),
    /** Abre por padrão no Lançamento: no máximo uma por Usuário. */
    padrao: z.boolean(),
  })
  .refine((v) => !v.incluirSemVenda || v.entradas.length > 0 || v.apenasComMinimo, {
    error: "Para salvar uma visão incluindo produtos sem venda, escolha um Filtro de produtos ou marque Apenas com estoque mínimo.",
    path: ["incluirSemVenda"],
  });
export type DadosVisaoPedidos = z.infer<typeof DadosVisaoPedidos>;

export interface VisaoPedidos extends DadosVisaoPedidos {
  id: string;
  usuarioId: string;
  version: number;
}
