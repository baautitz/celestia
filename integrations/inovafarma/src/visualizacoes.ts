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

/** As Visualizações das Baixas de Pré-vencido, com as mesmas regras das do Desempenho de Vendas. */
export const VISUALIZACAO_PERMISSION_BAIXAS = {
  geral: "inovafarma:pre-vencidos-baixas-geral:view",
  loja: "inovafarma:pre-vencidos-baixas-loja:view",
  individual: "inovafarma:pre-vencidos-baixas-individual:view",
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
 * no vínculo, a Visualização não está disponível. Nunca cai para Geral (fail-closed). `permissoes` diz a Permission
 * de cada Visualização (padrão: as do Desempenho de Vendas).
 */
export function visualizacoesDoUsuario(
  permissions: readonly string[] | undefined,
  vinculo: Pick<VinculoColaborador, "codigoColaborador" | "lojas"> | null,
  has: (permissions: readonly string[] | undefined, key: string) => boolean,
  permissoes: Readonly<Record<Visualizacao, string>> = VISUALIZACAO_PERMISSION,
): VisualizacoesDoUsuario {
  const lojas = vinculo?.lojas ?? [];
  const codigoColaborador = vinculo?.codigoColaborador ?? null;
  const disponiveis = VISUALIZACOES.filter((v) => {
    if (!has(permissions, permissoes[v])) return false;
    if (v === "loja") return lojas.length > 0;
    if (v === "individual") return codigoColaborador !== null;
    return true;
  });
  return { disponiveis, lojas, codigoColaborador };
}
