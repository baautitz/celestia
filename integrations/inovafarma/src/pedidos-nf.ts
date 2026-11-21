import { horaDoErp } from "./baixas-da-loja.js";
import { chaveDaLinha } from "./pedidos-conferencia.js";
import type { ErpQuery } from "./metas-comum.js";
import type { Pedido } from "./pedidos.js";

/**
 * Entradas de NF do ERP por produto e Loja desde a data do Pedido: `Compra` (não eliminada, por `DataNota`) e
 * `Compra_Produto`. Sem vínculo com `Compra_Pedido`: a conferência é só por produto, Loja e data.
 */
const entradasSql = (produtos: number) => `
  SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, c.CodigoEmpresa AS codigoLoja, CAST(SUM(cp.Quantidade) AS float) AS recebida
  FROM Compra c
  JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
  JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
  WHERE c.Eliminado = 0 AND c.DataNota >= @desde
    AND CONVERT(varchar(36), p.rowguid) IN (${Array.from({ length: produtos }, (_, i) => `@p${i}`).join(", ")})
  GROUP BY CONVERT(varchar(36), p.rowguid), c.CodigoEmpresa`;

/** O que já entrou por NF (`produtoId|codigoLoja` -> quantidade) dos produtos com fornecedor escolhido no Pedido. */
export async function entradasDoPedido(client: ErpQuery, pedido: Pick<Pedido, "itens" | "escolhas" | "criadoEm">): Promise<Map<string, number>> {
  const ids = pedido.itens.filter((i) => pedido.escolhas[i.produtoId] !== undefined).map((i) => i.produtoId);
  if (ids.length === 0) return new Map();
  const params: Record<string, unknown> = { desde: `${horaDoErp(pedido.criadoEm).slice(0, 10)} 00:00:00`, ...Object.fromEntries(ids.map((id, i) => [`p${i}`, id])) };
  const linhas = await client.query<{ produtoId: string; codigoLoja: number; recebida: number | null }>(entradasSql(ids.length), params);
  return new Map(linhas.map((l) => [chaveDaLinha(String(l.produtoId), Number(l.codigoLoja)), Number(l.recebida) || 0] as const));
}
