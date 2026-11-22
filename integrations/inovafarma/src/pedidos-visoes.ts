import { z } from "zod";
import { EntradaLista, idValido } from "./tipos-meta.js";

/**
 * Visão salva do Lançamento de Pedidos: os filtros que o comprador repete (Lojas, Filtro de produtos e
 * "apenas com mínimo"). Nunca guarda a data: ela sempre abre no padrão (ontem). Privada do Usuário.
 */
export const DadosVisaoPedidos = z.object({
  nome: z.string().trim().min(1, "Informe o nome da visão.").max(60, "O nome deve ter no máximo 60 caracteres."),
  lojas: z.array(z.number().int().min(1)).max(200),
  /** O "Filtro de produtos": Produtos, Grupos, Seções e Laboratórios (união). */
  entradas: z.array(EntradaLista.refine(idValido, "Uma entrada do Filtro de produtos tem um identificador inválido.")).max(500),
  apenasComMinimo: z.boolean(),
  /** Abre por padrão no Lançamento: no máximo uma por Usuário. */
  padrao: z.boolean(),
});
export type DadosVisaoPedidos = z.infer<typeof DadosVisaoPedidos>;

export interface VisaoPedidos extends DadosVisaoPedidos {
  id: string;
  usuarioId: string;
  version: number;
}
