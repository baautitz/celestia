import type { ColunaDesempenho } from "./colunas-desempenho.js";
import { COLUNA_DO_PRODUTO, idsPorTipo } from "./lista-produtos.js";


/**
 * Condição SQL da coluna sobre `p` (Produto): as entradas dela e as das colunas da união, por `OR`. Os ids vão por
 * parâmetro (`col<posição>_…`), nunca no SQL; sem nenhuma entrada, não casa com nada.
 */
export function condicaoDaColuna(coluna: Pick<ColunaDesempenho, "entradas" | "uniao">, todas: readonly ColunaDesempenho[], posicao: number, params: Record<string, unknown>): string {
  const entradas = [...coluna.entradas, ...coluna.uniao.flatMap((id) => todas.find((c) => c.id === id)?.entradas ?? [])];
  const condicoes = idsPorTipo(entradas, params, `col${posicao}_`).map(([tipo, nomes]) => `${COLUNA_DO_PRODUTO[tipo]} IN (${nomes})`);
  return condicoes.length ? `(${condicoes.join(" OR ")})` : "1 = 0";
}

// Como no relatório oficial do InovaFarma: vendas sem caixa aberto (CodigoAbertura nulo) ficam fora,
// a Taxa de Entrega (Produto_Inventario_Grupo 3) não conta como venda,
// e o valor que um PBM com financeiro (ex.: Farmácia Popular) reembolsa à loja entra no bruto e no líquido.
// O ERP deixa esse item com Total = 0 e TotalDesconto = 0; o reembolso fica só em Venda_Produto_PBM.
export const REEMBOLSO_PBM = "ISNULL(pbm.DescontoUnitarioPBM * vp.Quantidade, 0)";

/**
 * FROM e WHERE das vendas do Período com as regras da Venda Líquida (aliases `v`, `vp`, `p`, `pbm`).
 * `filtro` é montado pelo servidor com parâmetros, nunca com entrada do usuário.
 */
export const vendasFromWhere = (filtro: string) => `
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
      ${filtro}
  `;

/**
 * SQL do Desempenho de Vendas por Colaborador e do total de vendas. `filtroEmpresa` é montado pelo servidor
 * com parâmetros (`@dataInicio`, `@dataFim` e os do filtro), nunca com entrada do usuário. Os ids das `colunas` personalizadas
 * vêm em `params`, para somar aos do filtro.
 */
export function desempenhoSql(filtroEmpresa: string, colunas: readonly ColunaDesempenho[] = []) {
  const fromWhere = vendasFromWhere(filtroEmpresa);
  // Colunas personalizadas: `colQtd<i>`, `colValor<i>`, `colCmv<i>` e `colVendas<i>` (vendas distintas com item da coluna) na ordem de `colunas`; os ids das entradas vão em `params`.
  const params: Record<string, unknown> = {};
  const personalizadas = colunas.map((coluna, i) => {
    const condicao = condicaoDaColuna(coluna, colunas, i, params);
    return `,
      CAST(SUM(CASE WHEN ${condicao} THEN vp.Quantidade END) AS float) AS colQtd${i},
      CAST(SUM(CASE WHEN ${condicao} THEN vp.Total END) AS float) AS colValor${i},
      CAST(SUM(CASE WHEN ${condicao} THEN vp.Quantidade * vp.PrecoCusto END) AS float) AS colCmv${i},
      COUNT(DISTINCT CASE WHEN ${condicao} THEN vp.CodigoVenda END) AS colVendas${i}`;
  });

  const sql = `
    SELECT
      vp.CodigoFuncionario AS codigoColaborador,
      c.Nome AS nomeColaborador,
      COUNT(DISTINCT vp.CodigoVenda) AS quantidadeVendas,
      CAST(SUM(vp.Total + vp.TotalDesconto + ${REEMBOLSO_PBM}) AS float) AS totalBruto,
      CAST(SUM(vp.TotalDesconto) AS float) AS totalDesconto,
      CAST(SUM(vp.Total + ${REEMBOLSO_PBM}) AS float) AS totalLiquido,
      CAST(SUM(vp.Quantidade * vp.PrecoCusto) AS float) AS totalCmv,
      COUNT(DISTINCT CASE WHEN v.CodigoCadastro <> 0 THEN vp.CodigoVenda END) AS vendasComCadastro${personalizadas.join("")}
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
  return { sql, sqlTotalVendas, params };
}
