import { z } from "zod";

/**
 * Visão salva do Lançamento de Pedidos: os filtros que o comprador repete (Lojas, listas, Laboratório, Grupo, Seção e
 * "apenas com mínimo"). Nunca guarda a data: ela sempre abre no padrão (ontem). Privada do Usuário.
 */
export const DadosVisaoPedidos = z.object({
  nome: z.string().trim().min(1, "Informe o nome da visão.").max(60, "O nome deve ter no máximo 60 caracteres."),
  lojas: z.array(z.number().int().min(1)).max(200),
  /** Ids das listas de produtos (união). */
  listas: z.array(z.string().min(1).max(64)).max(100),
  laboratorio: z.string().regex(/^\d+$/).nullable(),
  grupo: z.string().regex(/^\d+$/).nullable(),
  secao: z.string().regex(/^\d+$/).nullable(),
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
