/** Busca de Produto no ERP, usada no Estoque e no lançamento de Pré-vencidos e na Lista de Produtos do Tipo de Meta. */

/** Mínimo de caracteres da busca de Produto: o ERP tem dezenas de milhares de cadastros. */
export const MIN_BUSCA_PRODUTO = 3;

/** Máximo de resultados de uma busca no ERP. */
export const LIMITE_BUSCA = 30;

/** Parâmetros da busca: `@busca` (código de barras exato) e `@buscaLike` (parte do nome, com `\` de escape). */
export const parametrosBusca = (q: string) => ({ busca: q, buscaLike: `%${q.replace(/[\\%_[]/g, "\\$&")}%` });

/**
 * Produtos pelo código de barras (principal ou alternativo) ou por parte do nome, sem os eliminados. Com `somenteAtivos`,
 * só os ativos em ao menos uma Loja (o ERP guarda o "ativo" por Loja, em `Produto_Estoque.Ativo`).
 * Colunas: `produtoId` (Produto.rowguid), `nome` e `codigoBarra`.
 */
export const buscaProdutosSql = ({ somenteAtivos }: { somenteAtivos: boolean }) => `
  SELECT TOP ${LIMITE_BUSCA} CONVERT(varchar(36), p.rowguid) AS produtoId, LTRIM(RTRIM(p.NomeProduto)) AS nome,
         CASE WHEN p.CodigoBarra = @busca OR EXISTS (SELECT 1 FROM Produto_CodigoBarra b WHERE b.CodigoProduto = p.CodigoProduto AND b.CodigoBarra = @busca)
              THEN @busca ELSE p.CodigoBarra END AS codigoBarra
  FROM Produto p
  WHERE p.Eliminado = 0${somenteAtivos ? "\n    AND EXISTS (SELECT 1 FROM Produto_Estoque e WHERE e.CodigoProduto = p.CodigoProduto AND e.Ativo = 1)" : ""}
    AND (p.CodigoBarra = @busca
         OR EXISTS (SELECT 1 FROM Produto_CodigoBarra b WHERE b.CodigoProduto = p.CodigoProduto AND b.CodigoBarra = @busca)
         OR p.NomeProduto LIKE @buscaLike ESCAPE '\\')
  ORDER BY p.NomeProduto
`;

// O código do produto no ERP é bloqueado para o usuário: a API só fala em `produtoId` (Produto.rowguid).
/** Um Produto pelo identificador opaco (`@produtoId`), com o código do ERP, que fica só no servidor. */
export const PRODUTO_SQL = `
  SELECT p.CodigoProduto AS codigoProduto, CONVERT(varchar(36), p.rowguid) AS produtoId,
         LTRIM(RTRIM(p.NomeProduto)) AS nome, p.CodigoBarra AS codigoBarra
  FROM Produto p
  WHERE p.Eliminado = 0 AND CONVERT(varchar(36), p.rowguid) = @produtoId
`;

export type LinhaProduto = { codigoProduto: number; produtoId: string; nome: string | null; codigoBarra: string | null };
