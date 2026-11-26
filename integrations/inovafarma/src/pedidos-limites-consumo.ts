import { horaDoErp } from "./baixas-da-loja.js";
import type { CotacaoStore } from "./cotacao-store.js";
import { vendasFromWhere } from "./desempenho-vendas.js";
import { COLUNA_DO_PRODUTO, idsPorTipo } from "./lista-produtos.js";
import type { ErpQuery } from "./metas-comum.js";
import { chaveDaLinha } from "./pedidos-conferencia.js";
import type { RegraLimite, ValorLimite } from "./pedidos-limites.js";
import { entradasDosPedidos } from "./pedidos-nf.js";
import type { PedidoStore } from "./pedidos-store.js";
import { fornecedoresDa, paraCotar } from "./pedidos.js";

/** O consumo de um saldo do Valor do Limite, em centavos. */
export interface SaldoLimite {
  /** null: o saldo único de todas as Lojas. */
  codigoLoja: number | null;
  valorCentavos: number;
  /** NF mais transferência recebida, menos a transferência enviada. */
  entradasCentavos: number;
  /** O que falta chegar dos Pedidos confirmados, ao preço cotado. */
  comprometidoCentavos: number;
  /** Custo do que foi vendido da lista: volta para o saldo. */
  repostoCentavos: number;
  /** Nunca passa do valor; negativo quando o Limite estourou. */
  saldoCentavos: number;
}

export interface DepsDoConsumo {
  client: ErpQuery;
  pedidos: PedidoStore;
  cotacoes: CotacaoStore;
  /** Hoje na hora do ERP, `AAAA-MM-DD`. */
  hoje?: string;
}

/** Produtos por consulta: o SQL Server aceita cerca de 2100 parâmetros, e a Lista usa até 500 deles. */
const LOTE_PRODUTOS = 1000;
const ABERTOS = ["confirmado", "parcialmente_recebido"];

type PorLoja = Map<number, number>;

const nomesDeParametros = (prefixo: string, valores: readonly unknown[], params: Record<string, unknown>) =>
  valores
    .map((valor, i) => {
      params[`${prefixo}${i}`] = valor;
      return `@${prefixo}${i}`;
    })
    .join(", ");

/** A condição sobre `p` (Produto) da Lista da Regra: as entradas unidas por `OR`, então cada produto conta uma vez. */
function daLista(regra: Pick<RegraLimite, "entradas">, params: Record<string, unknown>): string {
  const condicoes = idsPorTipo(regra.entradas, params, "ent").map(([tipo, nomes]) => `${COLUNA_DO_PRODUTO[tipo]} IN (${nomes})`);
  return condicoes.length ? `(${condicoes.join(" OR ")})` : "1 = 0";
}

const porLoja = (linhas: { codigoLoja: number; valor: number | null }[]): PorLoja => new Map(linhas.map((l) => [Number(l.codigoLoja), Math.round((Number(l.valor) || 0) * 100)]));

/** Entradas de NF (quantidade × preço da nota) da lista, na vigência, só das distribuidoras da Regra. */
async function entradasPorLoja(client: ErpQuery, regra: RegraLimite, valor: ValorLimite): Promise<PorLoja> {
  const params: Record<string, unknown> = { dataInicio: `${valor.inicio} 00:00:00`, dataFim: `${valor.fim} 23:59:59` };
  const lista = daLista(regra, params);
  const distribuidoras = regra.fornecedores.length
    ? `AND EXISTS (SELECT 1 FROM Fornecedor f WHERE f.CodigoCadastro = c.CodigoCadastro AND f.CodigoFornecedor IN (${nomesDeParametros("forn", regra.fornecedores, params)}))`
    : "";
  return porLoja(
    await client.query<{ codigoLoja: number; valor: number | null }>(
      `SELECT c.CodigoEmpresa AS codigoLoja, CAST(SUM(cp.Quantidade * cp.Preco) AS float) AS valor
       FROM Compra c
       JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
       JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
       WHERE c.Eliminado = 0 AND c.DataNota >= @dataInicio AND c.DataNota <= @dataFim AND ${lista} ${distribuidoras}
       GROUP BY c.CodigoEmpresa`,
      params,
    ),
  );
}

/** Grupo "TRANSFERENCIAS" em `Estoque_Movimentacao_Grupo`. */
const GRUPO_TRANSFERENCIA = 21;

/**
 * Transferências entre Lojas da lista na vigência, pelo custo: a recebida (`+`) soma, a enviada (`-`) desconta, e a
 * mesma mercadoria não conta duas vezes. Não têm distribuidora: todas contam.
 */
async function transferenciasPorLoja(client: ErpQuery, regra: RegraLimite, valor: ValorLimite): Promise<PorLoja> {
  const params: Record<string, unknown> = { dataInicio: `${valor.inicio} 00:00:00`, dataFim: `${valor.fim} 23:59:59` };
  const lista = daLista(regra, params);
  return porLoja(
    await client.query<{ codigoLoja: number; valor: number | null }>(
      `SELECT m.CodigoEmpresa AS codigoLoja, CAST(SUM(CASE m.Operacao WHEN '-' THEN -mp.TotalCusto ELSE mp.TotalCusto END) AS float) AS valor
       FROM Estoque_Movimentacao m
       JOIN Lancamento l ON l.CodigoLancamento = m.CodigoLancamento
       JOIN Estoque_Movimentacao_Produto mp ON mp.CodigoMovimento = m.CodigoMovimento
       JOIN Produto p ON p.CodigoProduto = mp.CodigoProduto
       WHERE m.CodigoGrupo = ${GRUPO_TRANSFERENCIA} AND m.Eliminado = 0 AND l.DataLancamento >= @dataInicio AND l.DataLancamento <= @dataFim AND ${lista}
       GROUP BY m.CodigoEmpresa`,
      params,
    ),
  );
}

/** Custo das vendas da lista na vigência (regras da Venda Líquida). A venda não tem distribuidora: todas contam. */
async function custoVendidoPorLoja(client: ErpQuery, regra: RegraLimite, valor: ValorLimite): Promise<PorLoja> {
  const params: Record<string, unknown> = { dataInicio: `${valor.inicio} 00:00:00`, dataFim: `${valor.fim} 23:59:59` };
  const lista = daLista(regra, params);
  return porLoja(
    await client.query<{ codigoLoja: number; valor: number | null }>(
      `SELECT v.CodigoEmpresa AS codigoLoja, CAST(SUM(vp.Quantidade * vp.PrecoCusto) AS float) AS valor
       ${vendasFromWhere(`AND ${lista}`)}
       GROUP BY v.CodigoEmpresa`,
      params,
    ),
  );
}

/** Quais dos produtos estão na Lista da Regra. */
export async function produtosDaLista(client: ErpQuery, regra: Pick<RegraLimite, "entradas">, ids: string[]): Promise<Set<string>> {
  const dentro = new Set<string>();
  for (let i = 0; i < ids.length; i += LOTE_PRODUTOS) {
    const params: Record<string, unknown> = {};
    const lote = nomesDeParametros("p", ids.slice(i, i + LOTE_PRODUTOS), params);
    const linhas = await client.query<{ produtoId: string }>(
      `SELECT CONVERT(varchar(36), p.rowguid) AS produtoId FROM Produto p WHERE CONVERT(varchar(36), p.rowguid) IN (${lote}) AND ${daLista(regra, params)}`,
      params,
    );
    for (const l of linhas) dentro.add(String(l.produtoId));
  }
  return dentro;
}

/** O que falta chegar dos Pedidos confirmados (lista e distribuidoras da Regra) vezes o preço cotado do fornecedor escolhido. */
async function comprometidoPorLoja({ client, pedidos, cotacoes }: DepsDoConsumo, regra: RegraLimite): Promise<PorLoja> {
  const total: PorLoja = new Map();
  const abertos = (await pedidos.listar()).filter((p) => ABERTOS.includes(p.status));
  const ids = [...new Set(abertos.flatMap((p) => Object.keys(p.escolhas).filter((id) => fornecedoresDa(p.escolhas[id]).length > 0)))];
  if (ids.length === 0) return total;
  const dentro = await produtosDaLista(client, regra, ids);
  const entradas = await entradasDosPedidos(client, abertos);
  for (const pedido of abertos) {
    const cotados = await cotacoes.listar(pedido.id);
    const recebidas = entradas.get(pedido) ?? new Map<string, number>();
    for (const item of pedido.itens) {
      const escolha = pedido.escolhas[item.produtoId];
      if (escolha === undefined || !dentro.has(item.produtoId)) continue;
      const precoDe = (codigo: number) => (regra.fornecedores.length && !regra.fornecedores.includes(codigo) ? 0 : (cotados.find((c) => c.codigoFornecedor === codigo)?.precos?.[item.produtoId] ?? 0));
      for (const q of item.quantidades) {
        // A parte das outras Lojas não é compra: do que falta, só conta até o que foi para as distribuidoras.
        const falta = Math.min(paraCotar(q), q.quantidade - (recebidas.get(chaveDaLinha(item.produtoId, q.codigoLoja)) ?? 0));
        if (falta <= 0) continue;
        let preco: number;
        if (typeof escolha === "number") preco = precoDe(escolha);
        else {
          // Produto dividido: preço médio do que cada distribuidora manda para a Loja.
          const parcelas = escolha.filter((p) => p.codigoLoja === q.codigoLoja);
          const unidades = parcelas.reduce((t, p) => t + p.quantidade, 0);
          preco = unidades ? parcelas.reduce((t, p) => t + p.quantidade * precoDe(p.codigoFornecedor), 0) / unidades : 0;
        }
        if (preco > 0) total.set(q.codigoLoja, (total.get(q.codigoLoja) ?? 0) + Math.round(falta * preco * 100));
      }
    }
  }
  return total;
}

/**
 * Os saldos do Valor do Limite: um só (todas as Lojas somadas) ou um por Loja. O comprometido só pesa na vigência em
 * curso: um Pedido ainda não recebido não pertence a um mês encerrado nem a um que não começou.
 */
export async function consumoDoLimite(deps: DepsDoConsumo, regra: RegraLimite, valor: ValorLimite): Promise<SaldoLimite[]> {
  const hoje = deps.hoje ?? horaDoErp(new Date().toISOString()).slice(0, 10);
  const emCurso = valor.inicio <= hoje && hoje <= valor.fim;
  const [notas, transferencias, reposto, comprometido] = await Promise.all([
    entradasPorLoja(deps.client, regra, valor),
    transferenciasPorLoja(deps.client, regra, valor),
    custoVendidoPorLoja(deps.client, regra, valor),
    emCurso ? comprometidoPorLoja(deps, regra) : Promise.resolve<PorLoja>(new Map()),
  ]);
  const { distribuicao } = valor;
  const saldos = distribuicao.tipo === "todas" ? [{ codigoLoja: null, valorCentavos: distribuicao.valorCentavos }] : distribuicao.lojas;
  const soma = (mapa: PorLoja, codigoLoja: number | null) => (codigoLoja === null ? [...mapa.values()].reduce((t, n) => t + n, 0) : (mapa.get(codigoLoja) ?? 0));
  return saldos.map(({ codigoLoja, valorCentavos }) => {
    const entradasCentavos = soma(notas, codigoLoja) + soma(transferencias, codigoLoja);
    const comprometidoCentavos = soma(comprometido, codigoLoja);
    const repostoCentavos = soma(reposto, codigoLoja);
    return {
      codigoLoja,
      valorCentavos,
      entradasCentavos,
      comprometidoCentavos,
      repostoCentavos,
      saldoCentavos: Math.min(valorCentavos, valorCentavos - entradasCentavos - comprometidoCentavos + repostoCentavos),
    };
  });
}
