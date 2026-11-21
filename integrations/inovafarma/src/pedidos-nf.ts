import { horaDoErp } from "./baixas-da-loja.js";
import { chaveDaLinha } from "./pedidos-conferencia.js";
import type { ErpQuery } from "./metas-comum.js";
import type { Pedido } from "./pedidos.js";

type Escolhido = Pick<Pedido, "itens" | "escolhas" | "criadoEm">;

/**
 * Entradas de NF do ERP por produto, Loja e dia da nota desde a data mais antiga dos Pedidos: `Compra` (não eliminada,
 * por `DataNota`) e `Compra_Produto`. Sem vínculo com `Compra_Pedido`: a conferência é só por produto, Loja e data.
 */
const entradasSql = (produtos: number) => `
  SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, c.CodigoEmpresa AS codigoLoja, CONVERT(varchar(10), c.DataNota, 120) AS dia,
         CAST(SUM(cp.Quantidade) AS float) AS recebida
  FROM Compra c
  JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
  JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
  WHERE c.Eliminado = 0 AND c.DataNota >= @desde
    AND CONVERT(varchar(36), p.rowguid) IN (${Array.from({ length: produtos }, (_, i) => `@p${i}`).join(", ")})
  GROUP BY CONVERT(varchar(36), p.rowguid), c.CodigoEmpresa, CONVERT(varchar(10), c.DataNota, 120)`;

const idsEscolhidos = (pedido: Escolhido) => pedido.itens.filter((i) => pedido.escolhas[i.produtoId] !== undefined).map((i) => i.produtoId);
const diaDoPedido = (pedido: Escolhido) => horaDoErp(pedido.criadoEm).slice(0, 10);

/**
 * O que já entrou por NF (`produtoId|codigoLoja` -> quantidade) de cada Pedido, com uma só consulta ao ERP para todos:
 * a janela começa no Pedido mais antigo e cada Pedido soma só as notas a partir da própria data.
 */
export async function entradasDosPedidos<P extends Escolhido>(client: ErpQuery, pedidos: P[]): Promise<Map<P, Map<string, number>>> {
  const resultado = new Map<P, Map<string, number>>(pedidos.map((p) => [p, new Map()]));
  const comProdutos = pedidos.filter((p) => idsEscolhidos(p).length > 0);
  if (comProdutos.length === 0) return resultado;
  const ids = [...new Set(comProdutos.flatMap(idsEscolhidos))];
  const desde = comProdutos.map(diaDoPedido).sort()[0];
  const params: Record<string, unknown> = { desde: `${desde} 00:00:00`, ...Object.fromEntries(ids.map((id, i) => [`p${i}`, id])) };
  const linhas = await client.query<{ produtoId: string; codigoLoja: number; dia: string; recebida: number | null }>(entradasSql(ids.length), params);
  for (const pedido of comProdutos) {
    const seus = new Set(idsEscolhidos(pedido));
    const dia = diaDoPedido(pedido);
    const soma = resultado.get(pedido) as Map<string, number>;
    for (const l of linhas) {
      if (!seus.has(String(l.produtoId)) || String(l.dia) < dia) continue;
      const chave = chaveDaLinha(String(l.produtoId), Number(l.codigoLoja));
      soma.set(chave, (soma.get(chave) ?? 0) + (Number(l.recebida) || 0));
    }
  }
  return resultado;
}

/** O que já entrou por NF (`produtoId|codigoLoja` -> quantidade) dos produtos com fornecedor escolhido no Pedido. */
export async function entradasDoPedido(client: ErpQuery, pedido: Escolhido): Promise<Map<string, number>> {
  return (await entradasDosPedidos(client, [pedido])).get(pedido) as Map<string, number>;
}
