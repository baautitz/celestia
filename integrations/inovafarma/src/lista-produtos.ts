import { REEMBOLSO_PBM, vendasFromWhere } from "./desempenho-vendas.js";
import { buscaProdutosSql, LIMITE_BUSCA } from "./produtos-erp.js";
import { TIPOS_ENTRADA, type EntradaLista, type ListaTipo, type TipoEntrada } from "./tipos-meta.js";

/** Como cada tipo de entrada casa com o produto vendido no ERP: a coluna de `Produto` comparada com o id da entrada. */
const COLUNA_DO_PRODUTO: Record<TipoEntrada, string> = {
  produto: "CONVERT(varchar(36), p.rowguid)",
  grupo: "p.CodigoGrupo",
  secao: "p.CodigoSessao",
  // Laboratório é o Fabricante do ERP.
  laboratorio: "p.CodigoFabricante",
};

/** O valor do parâmetro: o rowguid em texto no Produto, o código numérico nos demais. */
const parametro = (tipo: TipoEntrada, id: string): string | number => (tipo === "produto" ? id : Number(id));

/**
 * Os ids das entradas por parâmetro, nunca no SQL: para cada tipo com entradas, grava `@produto0`, `@produto1`… em
 * `params` e devolve o tipo com a lista dos nomes ("@produto0, @produto1").
 */
function idsPorTipo(entradas: Pick<EntradaLista, "tipo" | "id">[], params: Record<string, unknown>): [TipoEntrada, string][] {
  return TIPOS_ENTRADA.flatMap((tipo) => {
    const ids = entradas.filter((e) => e.tipo === tipo).map((e) => e.id);
    if (ids.length === 0) return [];
    const nomes = ids.map((id, i) => {
      params[`${tipo}${i}`] = parametro(tipo, id);
      return `@${tipo}${i}`;
    });
    return [[tipo, nomes.join(", ")]];
  });
}

/** Resultado da busca de entradas: o id no ERP, o nome e um detalhe opcional (o código de barras do Produto). */
export type ResultadoBusca = { id: string; nome: string; detalhe: string | null };

/**
 * Busca no ERP só no tipo escolhido, sem cadastros eliminados ou inativos (a Seção não tem marca de inativa no ERP).
 * Parâmetros: os de `parametrosBusca`.
 */
export const BUSCA_LISTA_SQL: Record<TipoEntrada, string> = {
  produto: `SELECT produtoId AS id, nome, codigoBarra AS detalhe FROM (${buscaProdutosSql({ somenteAtivos: true })}) AS b ORDER BY nome`,
  grupo: `
    SELECT TOP ${LIMITE_BUSCA} CAST(g.CodigoGrupo AS varchar(10)) AS id, LTRIM(RTRIM(g.NomeGrupo)) AS nome, NULL AS detalhe
    FROM Produto_Grupo g
    WHERE g.Ativo = 1 AND g.NomeGrupo LIKE @buscaLike ESCAPE '\\'
    ORDER BY g.NomeGrupo`,
  secao: `
    SELECT TOP ${LIMITE_BUSCA} CAST(s.CodigoSessao AS varchar(10)) AS id, LTRIM(RTRIM(s.NomeSessao)) AS nome, NULL AS detalhe
    FROM Produto_Sessao s
    WHERE s.NomeSessao LIKE @buscaLike ESCAPE '\\'
    ORDER BY s.NomeSessao`,
  // "REVISAR" é o Fabricante genérico do cadastro incompleto (dezenas de milhares de produtos): fica fora.
  laboratorio: `
    SELECT TOP ${LIMITE_BUSCA} CAST(f.CodigoFabricante AS varchar(10)) AS id, LTRIM(RTRIM(f.NomeFabricante)) AS nome, NULL AS detalhe
    FROM Produto_Fabricante f
    WHERE f.Eliminado = 0 AND UPPER(LTRIM(RTRIM(f.NomeFabricante))) <> 'REVISAR' AND f.NomeFabricante LIKE @buscaLike ESCAPE '\\'
    ORDER BY f.NomeFabricante`,
};

/** Quais entradas ainda existem no ERP (com ou sem venda); as que não voltam ficam com o aviso "não encontrado no ERP". */
export function conferirSql(entradas: Pick<EntradaLista, "tipo" | "id">[]): { sql: string; params: Record<string, unknown> } | null {
  const params: Record<string, unknown> = {};
  const fontes: Record<TipoEntrada, (nomes: string) => string> = {
    produto: (nomes) => `SELECT 'produto' AS tipo, CONVERT(varchar(36), p.rowguid) AS id FROM Produto p WHERE CONVERT(varchar(36), p.rowguid) IN (${nomes})`,
    grupo: (nomes) => `SELECT 'grupo' AS tipo, CAST(CodigoGrupo AS varchar(10)) AS id FROM Produto_Grupo WHERE CodigoGrupo IN (${nomes})`,
    secao: (nomes) => `SELECT 'secao' AS tipo, CAST(CodigoSessao AS varchar(10)) AS id FROM Produto_Sessao WHERE CodigoSessao IN (${nomes})`,
    laboratorio: (nomes) => `SELECT 'laboratorio' AS tipo, CAST(CodigoFabricante AS varchar(10)) AS id FROM Produto_Fabricante WHERE CodigoFabricante IN (${nomes})`,
  };
  const partes = idsPorTipo(entradas, params).map(([tipo, nomes]) => fontes[tipo](nomes));
  return partes.length ? { sql: partes.join("\nUNION ALL\n"), params } : null;
}

/** Total vendido da Lista por Colaborador no Período, em unidades e em valor líquido (R$, não centavos). */
export type LinhaLista = { codigoColaborador: number; quantidade: number | null; valor: number | null };

/**
 * Uma consulta por Tipo de Meta: as entradas da Lista unidas por `OR` sobre o produto vendido, então cada linha de venda
 * conta uma vez, mesmo com o produto em várias entradas. As regras são as da Venda Líquida (`vendasFromWhere`).
 * Uma entrada cujo id não existe mais no ERP não casa com nenhuma venda. Os ids vão por parâmetro, nunca no SQL.
 */
export function listaSql(lista: Pick<ListaTipo, "entradas">): { sql: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {};
  const condicoes = idsPorTipo(lista.entradas, params).map(([tipo, nomes]) => `${COLUNA_DO_PRODUTO[tipo]} IN (${nomes})`);
  const sql = `
    SELECT vp.CodigoFuncionario AS codigoColaborador,
      CAST(SUM(vp.Quantidade) AS float) AS quantidade,
      CAST(SUM(vp.Total + ${REEMBOLSO_PBM}) AS float) AS valor
    ${vendasFromWhere(`AND (${condicoes.length ? condicoes.join("\n        OR ") : "1 = 0"})`)}
    GROUP BY vp.CodigoFuncionario
  `;
  return { sql, params };
}
