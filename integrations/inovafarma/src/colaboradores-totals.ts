interface TotaisGerais {
  totalVendasGeral: number;
  totalBrutoGeral: number;
  totalDescontoGeral: number;
  totalLiquidoGeral: number;
  totalCmvGeral: number;
  categorias: Record<string, { quantidade: number; valor: number }>;
}

/**
 * Totalizador da tabela de Colaboradores: os totais gerais já calculados pelo servidor, por `key` de coluna.
 * Só colunas somáveis; percentuais, ticket médio e participação ficam em branco.
 */
export function colaboradoresTotals(resumo: TotaisGerais | null): Record<string, number> | undefined {
  if (!resumo) return undefined;
  const categorias = Object.entries(resumo.categorias).flatMap(([key, { quantidade, valor }]) => [
    [`${key}-quantidade`, quantidade] as const,
    [`${key}-valor`, valor] as const,
  ]);
  return {
    quantidadeVendas: resumo.totalVendasGeral,
    totalBruto: resumo.totalBrutoGeral,
    totalDesconto: resumo.totalDescontoGeral,
    totalLiquido: resumo.totalLiquidoGeral,
    totalCmv: resumo.totalCmvGeral,
    ...Object.fromEntries(categorias),
  };
}

type Favorable = "up" | "down" | "neutral";

/** Comparação do Totalizador com o total do Período anterior, por `key` de coluna. */
export function colaboradoresTotalsCompare(
  anterior: { label: string; resumo: TotaisGerais } | null,
  favorableByColumn: Partial<Record<string, Favorable>>,
): Record<string, { previous: number; label: string; favorable: Favorable | undefined }> | undefined {
  if (!anterior) return undefined;
  const previous = colaboradoresTotals(anterior.resumo) ?? {};
  return Object.fromEntries(
    Object.entries(previous).map(([key, value]) => [key, { previous: value, label: anterior.label, favorable: favorableByColumn[key] }]),
  );
}
