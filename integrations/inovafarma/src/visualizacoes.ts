import type { Context } from "hono";
import { z } from "zod";
import { recusaDeValidacao } from "./metas-comum.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
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

const QueryVisualizacao = z.object({ visualizacao: z.enum(VISUALIZACOES, { error: "Parâmetro 'visualizacao' deve ser geral, loja ou individual." }).optional() });

/**
 * Visualização pedida na query (a mais ampla disponível, sem ela): 400 se não existe, 403 se o Usuário não tem nenhuma
 * ou não tem a pedida; nunca cai para outra (fail-closed). `permissoes` diz a Permission de cada Visualização.
 */
export function visualizacaoPedida(c: Context, disponiveis: readonly Visualizacao[], permissoes: Readonly<Record<Visualizacao, string>>) {
  const parsed = QueryVisualizacao.safeParse({ visualizacao: c.req.query("visualizacao") });
  if (!parsed.success) return { recusa: recusaDeValidacao(c, parsed.error) } as const;
  const [primeira] = disponiveis;
  if (!primeira) return { recusa: c.json({ error: SEM_VISUALIZACAO }, 403) } as const;
  const visualizacao = parsed.data.visualizacao ?? primeira;
  if (!disponiveis.includes(visualizacao)) {
    const item = INOVAFARMA_PERMISSIONS.items.find((i) => i.key === permissoes[visualizacao]);
    return { recusa: c.json({ error: item?.deniedMessage ?? SEM_VISUALIZACAO }, 403) } as const;
  }
  return { visualizacao } as const;
}
