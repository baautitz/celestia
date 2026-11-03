import { REEMBOLSO_PBM, vendasFromWhere } from "./desempenho-vendas.js";
import { BUSCA_SQL } from "./pre-vencidos-routes.js";
import type { EntradaLista, ListaTipo, TipoEntrada } from "./tipos-meta.js";

/** Como cada tipo de entrada casa com o produto vendido no ERP: a coluna de `Produto` comparada com o id da entrada. */
const COLUNA_DO_PRODUTO: Record<TipoEntrada, string> = {
  produto: "CONVERT(varchar(36), p.rowguid)",
};

/** Mínimo de caracteres da busca: o Produto tem dezenas de milhares de cadastros. */
export const MIN_BUSCA_LISTA: Record<TipoEntrada, number> = { produto: 3 };

/** Resultado da busca de entradas: o id no ERP, o nome e um detalhe opcional (o código de barras do Produto). */
export type ResultadoBusca = { id: string; nome: string; detalhe: string | null };

/**
 * Busca no ERP só no tipo escolhido, sem cadastros eliminados ou inativos. Parâmetros: `@busca` (código de barras
 * exato) e `@buscaLike` (parte do nome, com `\` de escape).
 */
export const BUSCA_LISTA_SQL: Record<TipoEntrada, string> = {
  produto: `SELECT produtoId AS id, nome, codigoBarra AS detalhe FROM (${BUSCA_SQL}) AS b`,
};

/** Quais entradas ainda existem no ERP (com ou sem venda); as que não voltam ficam com o aviso "não encontrado no ERP". */
export function conferirSql(entradas: Pick<EntradaLista, "tipo" | "id">[]): { sql: string; params: Record<string, unknown> } | null {
  const params: Record<string, unknown> = {};
  const fontes: Record<TipoEntrada, (nomes: string) => string> = {
    produto: (nomes) => `SELECT 'produto' AS tipo, CONVERT(varchar(36), p.rowguid) AS id FROM Produto p WHERE CONVERT(varchar(36), p.rowguid) IN (${nomes})`,
  };
  const partes = (Object.keys(fontes) as TipoEntrada[]).flatMap((tipo) => {
    const ids = entradas.filter((e) => e.tipo === tipo).map((e) => e.id);
    if (ids.length === 0) return [];
    const nomes = ids.map((id, i) => {
      params[`${tipo}${i}`] = id;
      return `@${tipo}${i}`;
    });
    return [fontes[tipo](nomes.join(", "))];
  });
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
  const condicoes = (Object.keys(COLUNA_DO_PRODUTO) as TipoEntrada[]).flatMap((tipo) => {
    const ids = lista.entradas.filter((e) => e.tipo === tipo).map((e) => e.id);
    if (ids.length === 0) return [];
    const nomes = ids.map((id, i) => {
      params[`${tipo}${i}`] = id;
      return `@${tipo}${i}`;
    });
    return [`${COLUNA_DO_PRODUTO[tipo]} IN (${nomes.join(", ")})`];
  });
  const sql = `
    SELECT vp.CodigoFuncionario AS codigoColaborador,
      CAST(SUM(vp.Quantidade) AS float) AS quantidade,
      CAST(SUM(vp.Total + ${REEMBOLSO_PBM}) AS float) AS valor
    ${vendasFromWhere(`AND (${condicoes.length ? condicoes.join("\n        OR ") : "1 = 0"})`)}
    GROUP BY vp.CodigoFuncionario
  `;
  return { sql, params };
}
