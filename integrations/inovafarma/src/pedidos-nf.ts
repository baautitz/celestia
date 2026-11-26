import { horaDoErp } from "./baixas-da-loja.js";
import { chaveDaLinha } from "./pedidos-conferencia.js";
import type { ErpQuery } from "./metas-comum.js";
import type { Pedido } from "./pedidos.js";

type Escolhido = Pick<Pedido, "itens" | "escolhas" | "criadoEm">;

/**
 * Entradas do ERP por produto, Loja e dia desde a data mais antiga dos Pedidos: as NFs (`Compra`, não eliminada, por
 * `DataNota`) e as transferências recebidas de outra Loja (movimentação `+` do grupo 21, "TRANSFERENCIAS"). Sem vínculo
 * com `Compra_Pedido`: a conferência é só por produto, Loja e data.
 */
const entradasSql = (produtos: number) => {
  const ids = Array.from({ length: produtos }, (_, i) => `@p${i}`).join(", ");
  return `
  SELECT produtoId, codigoLoja, dia, CAST(SUM(quantidade) AS float) AS recebida
  FROM (
    SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, c.CodigoEmpresa AS codigoLoja, CONVERT(varchar(10), c.DataNota, 120) AS dia, cp.Quantidade AS quantidade
    FROM Compra c
    JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
    JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
    WHERE c.Eliminado = 0 AND c.DataNota >= @desde AND CONVERT(varchar(36), p.rowguid) IN (${ids})
    UNION ALL
    SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, m.CodigoEmpresa AS codigoLoja, CONVERT(varchar(10), l.DataLancamento, 120) AS dia, mp.Quantidade AS quantidade
    FROM Estoque_Movimentacao m
    JOIN Lancamento l ON l.CodigoLancamento = m.CodigoLancamento
    JOIN Estoque_Movimentacao_Produto mp ON mp.CodigoMovimento = m.CodigoMovimento
    JOIN Produto p ON p.CodigoProduto = mp.CodigoProduto
    WHERE m.CodigoGrupo = 21 AND m.Operacao = '+' AND m.Eliminado = 0 AND l.DataLancamento >= @desde AND CONVERT(varchar(36), p.rowguid) IN (${ids})
  ) e
  GROUP BY produtoId, codigoLoja, dia`;
};

const idsEscolhidos = (pedido: Escolhido) => pedido.itens.filter((i) => pedido.escolhas[i.produtoId] !== undefined || i.quantidades.some((q) => q.lojasFornecedoras?.length)).map((i) => i.produtoId);
const diaDoPedido = (pedido: Escolhido) => horaDoErp(pedido.criadoEm).slice(0, 10);

/**
 * O que já entrou (`produtoId|codigoLoja` -> quantidade) de cada Pedido, com uma só consulta ao ERP para todos:
 * a janela começa no Pedido mais antigo e cada Pedido soma só as entradas a partir da própria data.
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

/** O que já entrou (`produtoId|codigoLoja` -> quantidade) dos produtos com fornecedor escolhido no Pedido. */
export async function entradasDoPedido(client: ErpQuery, pedido: Escolhido): Promise<Map<string, number>> {
  return (await entradasDosPedidos(client, [pedido])).get(pedido) as Map<string, number>;
}

/**
 * As mesmas entradas separadas por quem mandou: o código da distribuidora (NF) ou o negativo do código da Loja de
 * origem (transferência); 0 quando o ERP não identifica.
 */
const porOrigemSql = (produtos: number) => {
  const ids = Array.from({ length: produtos }, (_, i) => `@p${i}`).join(", ");
  return `
  SELECT produtoId, codigoLoja, origem, CAST(SUM(quantidade) AS float) AS recebida
  FROM (
    SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, c.CodigoEmpresa AS codigoLoja, ISNULL(f.CodigoFornecedor, 0) AS origem, cp.Quantidade AS quantidade
    FROM Compra c
    JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
    JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
    OUTER APPLY (SELECT TOP 1 fo.CodigoFornecedor FROM Fornecedor fo WHERE fo.CodigoCadastro = c.CodigoCadastro) f
    WHERE c.Eliminado = 0 AND c.DataNota >= @desde AND CONVERT(varchar(36), p.rowguid) IN (${ids})
    UNION ALL
    SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, m.CodigoEmpresa AS codigoLoja, -ISNULL(t.CodigoEmpresa, 0) AS origem, mp.Quantidade AS quantidade
    FROM Estoque_Movimentacao m
    JOIN Lancamento l ON l.CodigoLancamento = m.CodigoLancamento
    JOIN Estoque_Movimentacao_Produto mp ON mp.CodigoMovimento = m.CodigoMovimento
    JOIN Produto p ON p.CodigoProduto = mp.CodigoProduto
    OUTER APPLY (SELECT TOP 1 et.CodigoEmpresa FROM Estoque_Transferencia_Operacao o JOIN Estoque_Transferencia et ON et.CodigoTransferencia = o.CodigoTransferencia WHERE o.CodigoLancamento = m.CodigoLancamento) t
    WHERE m.CodigoGrupo = 21 AND m.Operacao = '+' AND m.Eliminado = 0 AND l.DataLancamento >= @desde AND CONVERT(varchar(36), p.rowguid) IN (${ids})
  ) e
  GROUP BY produtoId, codigoLoja, origem`;
};

/** `produtoId|codigoLoja` -> origem -> quantidade, do que entrou desde a data do Pedido. */
export async function entradasPorOrigem(client: ErpQuery, pedido: Escolhido): Promise<Map<string, Map<number, number>>> {
  const resultado = new Map<string, Map<number, number>>();
  const ids = idsEscolhidos(pedido);
  if (ids.length === 0) return resultado;
  const params: Record<string, unknown> = { desde: `${diaDoPedido(pedido)} 00:00:00`, ...Object.fromEntries(ids.map((id, i) => [`p${i}`, id])) };
  for (const l of await client.query<{ produtoId: string; codigoLoja: number; origem: number | null; recebida: number | null }>(porOrigemSql(ids.length), params)) {
    const chave = chaveDaLinha(String(l.produtoId), Number(l.codigoLoja));
    const origens = resultado.get(chave) ?? new Map<number, number>();
    const origem = Number(l.origem) || 0;
    origens.set(origem, (origens.get(origem) ?? 0) + (Number(l.recebida) || 0));
    resultado.set(chave, origens);
  }
  return resultado;
}
