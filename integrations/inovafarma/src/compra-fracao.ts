/**
 * A linha de compra do ERP vem na embalagem da NF (`1 CX`, fração 100); estoque, venda, transferência, Pedido e cotação
 * são por unidade. Estas expressões convertem a linha `cp` (`Compra_Produto`); sem fração informada, vale 1.
 */
const FRACAO = "ISNULL(NULLIF(cp.FracaoVenda, 0), 1)";
export const UNIDADES_COMPRADAS = `cp.Quantidade * ${FRACAO}`;
export const PRECO_POR_UNIDADE = `cp.Preco / ${FRACAO}`;
