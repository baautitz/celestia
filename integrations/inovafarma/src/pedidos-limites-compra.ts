import { PRECO_POR_UNIDADE } from "./compra-fracao.js";
import { chaveDaLinha } from "./pedidos-conferencia.js";
import { aChegarDosPedidos, produtosSql, type LinhaVenda } from "./pedidos-lancamento-routes.js";
import { consumoDoLimite, daLista, produtosDaLista, type DepsDoConsumo } from "./pedidos-limites-consumo.js";
import type { RegraLimite, ValorLimite } from "./pedidos-limites.js";
import type { MinimoMaximoStore } from "./pedidos-minimos-store.js";

/** Uma compra que se pretende fazer: quanto de um produto, para qual Loja, de qual fornecedor, a que preço. */
export interface CompraPretendida {
  produtoId: string;
  codigoLoja: number;
  codigoFornecedor: number;
  quantidade: number;
  preco: number;
}

/** Um saldo de Limite que o Pedido ultrapassa. */
export interface Estouro {
  regra: string;
  /** null: o saldo único de todas as Lojas. */
  codigoLoja: number | null;
  saldoCentavos: number;
  pedidoCentavos: number;
  excedeCentavos: number;
}

const emVigencia = (v: ValorLimite, hoje: string) => v.inicio <= hoje && hoje <= v.fim;

/** Os saldos em vigência que as compras pretendidas ultrapassam. O Limite só avisa: quem decide é quem confirma. */
export async function estourosDoPedido(deps: DepsDoConsumo & { hoje: string }, regras: RegraLimite[], valores: ValorLimite[], compras: CompraPretendida[]): Promise<Estouro[]> {
  const estouros: Estouro[] = [];
  const ids = [...new Set(compras.map((c) => c.produtoId))];
  for (const valor of valores.filter((v) => emVigencia(v, deps.hoje))) {
    const regra = regras.find((r) => r.id === valor.regraId);
    if (!regra || ids.length === 0) continue;
    const dentro = await produtosDaLista(deps.client, regra, ids);
    const daRegra = compras.filter((c) => dentro.has(c.produtoId) && (regra.fornecedores.length === 0 || regra.fornecedores.includes(c.codigoFornecedor)));
    if (daRegra.length === 0) continue;
    for (const s of await consumoDoLimite(deps, regra, valor)) {
      const pedidoCentavos = daRegra.filter((c) => s.codigoLoja === null || c.codigoLoja === s.codigoLoja).reduce((t, c) => t + Math.round(c.quantidade * c.preco * 100), 0);
      const excedeCentavos = pedidoCentavos - Math.max(0, s.saldoCentavos);
      if (pedidoCentavos > 0 && excedeCentavos > 0) estouros.push({ regra: regra.nome, codigoLoja: s.codigoLoja, saldoCentavos: s.saldoCentavos, pedidoCentavos, excedeCentavos });
    }
  }
  return estouros;
}

export interface ProdutoSugerido {
  produtoId: string;
  codigoProduto: number | null;
  nome: string;
  vendida: number;
  estoque: number;
  aChegar: number;
  sugestao: number;
  /** Por unidade, da última compra; null sem compra anterior. */
  preco: number | null;
  valorCentavos: number | null;
  /** O acumulado até este produto ainda cabe no saldo. */
  cabe: boolean;
}

export interface SugestaoDoLimite {
  saldoCentavos: number;
  totalCentavos: number;
  produtos: ProdutoSugerido[];
}

const ultimosPrecosSql = (filtro: string) => `
  SELECT produtoId, codigoLoja, CAST(preco AS float) AS preco
  FROM (
    SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, c.CodigoEmpresa AS codigoLoja, ${PRECO_POR_UNIDADE} AS preco,
           ROW_NUMBER() OVER (PARTITION BY p.CodigoProduto, c.CodigoEmpresa ORDER BY c.DataNota DESC, c.CodigoCompra DESC) AS n
    FROM Compra c
    JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
    JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
    WHERE c.Eliminado = 0 ${filtro}
  ) x
  WHERE x.n = 1`;

/**
 * O que comprar da lista da Regra: por Loja, o que vendeu na vigência mais o mínimo, menos o estoque e o que está a
 * chegar. Os mais vendidos vêm primeiro e ocupam o saldo nessa ordem.
 */
export async function sugestaoDoLimite(deps: DepsDoConsumo & { hoje: string; minimos: MinimoMaximoStore }, regra: RegraLimite, valor: ValorLimite, codigoLoja: number | null): Promise<SugestaoDoLimite> {
  const saldos = await consumoDoLimite(deps, regra, valor);
  const saldoCentavos = saldos.find((s) => s.codigoLoja === codigoLoja)?.saldoCentavos ?? 0;

  const [ate] = [deps.hoje, valor.fim].sort();
  const params: Record<string, unknown> = { dataInicio: `${valor.inicio} 00:00:00`, dataFim: `${ate} 23:59:59` };
  const filtroVenda = `AND ${daLista(regra, params)}${codigoLoja === null ? "" : " AND v.CodigoEmpresa = @loja"}`;
  const paramsPreco: Record<string, unknown> = {};
  const filtroPreco = `AND ${daLista(regra, paramsPreco)}${codigoLoja === null ? "" : " AND c.CodigoEmpresa = @loja"}`;
  if (codigoLoja !== null) params.loja = paramsPreco.loja = codigoLoja;

  const [vendas, precos, minimos, chegando] = await Promise.all([
    deps.client.query<LinhaVenda>(produtosSql(filtroVenda), params),
    deps.client.query<{ produtoId: string; codigoLoja: number; preco: number | null }>(ultimosPrecosSql(filtroPreco), paramsPreco),
    deps.minimos.listar(),
    aChegarDosPedidos(deps.client, deps.pedidos),
  ]);
  const precoDe = new Map(precos.map((p) => [chaveDaLinha(p.produtoId, Number(p.codigoLoja)), Number(p.preco) || 0]));
  const minimoDe = new Map(minimos.map((m) => [chaveDaLinha(m.produtoId, m.codigoLoja), m.minimo]));

  const porProduto = new Map<string, ProdutoSugerido>();
  for (const v of vendas) {
    const chave = chaveDaLinha(v.produtoId, Number(v.codigoLoja));
    const vendida = Number(v.vendida) || 0;
    const estoque = Number(v.estoque) || 0;
    const aChegar = chegando.get(chave) ?? 0;
    const sugestao = Math.max(0, Math.ceil(vendida + (minimoDe.get(chave) ?? 0) - estoque - aChegar));
    const preco = precoDe.get(chave) || null;
    const p = porProduto.get(v.produtoId) ?? { produtoId: v.produtoId, codigoProduto: v.codigoProduto == null ? null : Number(v.codigoProduto), nome: (v.nome ?? "").trim(), vendida: 0, estoque: 0, aChegar: 0, sugestao: 0, preco: null, valorCentavos: null, cabe: false };
    p.vendida += vendida;
    p.estoque += estoque;
    p.aChegar += aChegar;
    p.sugestao += sugestao;
    if (preco !== null) {
      p.preco = preco;
      p.valorCentavos = (p.valorCentavos ?? 0) + Math.round(sugestao * preco * 100);
    }
    porProduto.set(v.produtoId, p);
  }

  let acumulado = 0;
  const produtos = [...porProduto.values()]
    .filter((p) => p.sugestao > 0)
    .sort((a, b) => b.vendida - a.vendida || a.nome.localeCompare(b.nome))
    .map((p) => {
      acumulado += p.valorCentavos ?? 0;
      return { ...p, cabe: p.valorCentavos !== null && acumulado <= saldoCentavos };
    });
  return { saldoCentavos, totalCentavos: acumulado, produtos };
}
