import type { VinculoColaborador } from "./vinculo-store.js";

/** Escopo de um relatório de Plugin: cada Visualização tem a própria Permission e a própria query. */
export type Visualizacao = "geral" | "loja" | "individual";

/** Da mais ampla para a mais restrita: a primeira disponível é a que a tela abre. */
export const VISUALIZACOES: Visualizacao[] = ["geral", "loja", "individual"];

export const VISUALIZACAO_PERMISSION = {
  geral: "inovafarma:vendas-geral:view",
  loja: "inovafarma:vendas-loja:view",
  individual: "inovafarma:vendas-individual:view",
} as const satisfies Record<Visualizacao, string>;

export const SEM_VISUALIZACAO = "Seu perfil não possui nenhuma visualização disponível.";

export interface VisualizacoesDoUsuario {
  disponiveis: Visualizacao[];
  /** Lojas do Colaborador vinculado, base da Visualização Loja. */
  lojas: number[];
  /** Colaborador vinculado, base da Visualização Individual. */
  codigoColaborador: number | null;
}

/**
 * Loja e Individual dependem da Permission e do vínculo do Usuário (#53): sem vínculo, ou sem Lojas
 * no vínculo, a Visualização não está disponível. Nunca cai para Geral (fail-closed).
 */
export function visualizacoesDoUsuario(
  permissions: readonly string[] | undefined,
  vinculo: Pick<VinculoColaborador, "codigoColaborador" | "lojas"> | null,
  has: (permissions: readonly string[] | undefined, key: string) => boolean,
): VisualizacoesDoUsuario {
  const lojas = vinculo?.lojas ?? [];
  const codigoColaborador = vinculo?.codigoColaborador ?? null;
  const disponiveis = VISUALIZACOES.filter((v) => {
    if (!has(permissions, VISUALIZACAO_PERMISSION[v])) return false;
    if (v === "loja") return lojas.length > 0;
    if (v === "individual") return codigoColaborador !== null;
    return true;
  });
  return { disponiveis, lojas, codigoColaborador };
}
