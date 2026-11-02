/**
 * Categorias de produto somadas no Desempenho de Vendas (Qtde em unidades e Valor líquido).
 * IDs fixos da base do cliente: Vitaminas por Produto_Grupo; as demais por Produto_Sessao.
 * `filtro` entra literal no SQL: é constante, nunca entrada do usuário.
 */
const CATEGORIAS_FOCO = {
  vitaminas: { coluna: "Vitaminas", filtro: "p.CodigoGrupo = 44" },
  genericos: { coluna: "Genericos", filtro: "p.CodigoSessao = 261" },
  similares: { coluna: "Similares", filtro: "p.CodigoSessao = 271" },
  incentivos: { coluna: "Incentivos", filtro: "p.CodigoSessao = 281" },
} as const;

/**
 * Total Foco: itens de qualquer categoria, contados uma vez. Uma Vitamina pode estar na seção de
 * Similares ou Incentivos, então somar as colunas contaria o item em dobro; o OR no SQL evita isso.
 */
export const CATEGORIAS = {
  ...CATEGORIAS_FOCO,
  totalFoco: {
    coluna: "TotalFoco",
    filtro: `(${Object.values(CATEGORIAS_FOCO)
      .map((c) => c.filtro)
      .join(" OR ")})`,
  },
} as const;

export type Categoria = keyof typeof CATEGORIAS;
export type CategoriaColuna = (typeof CATEGORIAS)[Categoria]["coluna"];
export type CategoriaTotal = { quantidade: number; valor: number };
export type CategoriaTotais = Record<Categoria, CategoriaTotal>;

export const porCategoria = (fn: (categoria: Categoria) => CategoriaTotal): CategoriaTotais => ({
  vitaminas: fn("vitaminas"),
  genericos: fn("genericos"),
  similares: fn("similares"),
  incentivos: fn("incentivos"),
  totalFoco: fn("totalFoco"),
});

/**
 * SQL do Desempenho de Vendas por Colaborador e do total de vendas. `filtroEmpresa` é montado pelo servidor
 * com parâmetros (`@dataInicio`, `@dataFim` e os do filtro), nunca com entrada do usuário.
 */
export function desempenhoSql(filtroEmpresa: string) {
  // Como no relatório oficial do InovaFarma: vendas sem caixa aberto (CodigoAbertura nulo) ficam fora,
  // a Taxa de Entrega (Produto_Inventario_Grupo 3) não conta como venda,
  // e o valor que um PBM com financeiro (ex.: Farmácia Popular) reembolsa à loja entra no bruto e no líquido.
  // O ERP deixa esse item com Total = 0 e TotalDesconto = 0; o reembolso fica só em Venda_Produto_PBM.
  const reembolsoPbm = "ISNULL(pbm.DescontoUnitarioPBM * vp.Quantidade, 0)";

  const fromWhere = `
    FROM Venda v
    JOIN Venda_Produto vp ON vp.CodigoVenda = v.CodigoVenda
    JOIN Funcionario f ON f.CodigoFuncionario = vp.CodigoFuncionario
    JOIN Cadastro c ON c.CodigoCadastro = f.CodigoCadastro
    LEFT JOIN Produto p ON p.CodigoProduto = vp.CodigoProduto
    LEFT JOIN Venda_Produto_PBM pbm ON pbm.CodigoVendaID = vp.CodigoVendaID
      AND EXISTS (SELECT 1 FROM Venda_PBM vpb WHERE vpb.CodigoVenda = v.CodigoVenda AND vpb.TemFinanceiro = 1)
    WHERE v.Eliminado = 0
      AND v.CodigoAbertura IS NOT NULL
      AND ISNULL(p.CodigoGrupoInventario, 0) <> 3
      AND v.DataVenda >= @dataInicio
      AND v.DataVenda <= @dataFim
      ${filtroEmpresa}
  `;

  const sql = `
    SELECT
      vp.CodigoFuncionario AS codigoColaborador,
      c.Nome AS nomeColaborador,
      COUNT(DISTINCT vp.CodigoVenda) AS quantidadeVendas,
      CAST(SUM(vp.Total + vp.TotalDesconto + ${reembolsoPbm}) AS float) AS totalBruto,
      CAST(SUM(vp.TotalDesconto) AS float) AS totalDesconto,
      CAST(SUM(vp.Total + ${reembolsoPbm}) AS float) AS totalLiquido,
      CAST(SUM(vp.Quantidade * vp.PrecoCusto) AS float) AS totalCmv,
      COUNT(DISTINCT CASE WHEN v.CodigoCadastro <> 0 THEN vp.CodigoVenda END) AS vendasComCadastro,
      ${Object.values(CATEGORIAS).map(({ coluna, filtro }) => {
        return `CAST(SUM(CASE WHEN ${filtro} THEN vp.Quantidade END) AS float) AS qtd${coluna},
      CAST(SUM(CASE WHEN ${filtro} THEN vp.Total END) AS float) AS valor${coluna}`;
      }).join(",\n            ")}
    ${fromWhere}
    GROUP BY vp.CodigoFuncionario, c.Nome
    ORDER BY totalLiquido DESC
  `;

  // CodigoCadastro = 0 é o "CONSUMIDOR" (venda sem cliente cadastrado).
  // Uma venda com itens de vários Colaboradores conta em cada um; o total geral conta cada venda uma vez.
  const sqlTotalVendas = `
    SELECT
      COUNT(DISTINCT v.CodigoVenda) AS totalVendasGeral,
      COUNT(DISTINCT CASE WHEN v.CodigoCadastro <> 0 THEN v.CodigoVenda END) AS totalVendasComCadastro
    ${fromWhere}
  `;
  return { sql, sqlTotalVendas };
}
