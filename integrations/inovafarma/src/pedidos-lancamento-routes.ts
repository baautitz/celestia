import { PRECO_POR_UNIDADE, UNIDADES_COMPRADAS } from "./compra-fracao.js";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { horaDoErp } from "./baixas-da-loja.js";
import { vendasFromWhere } from "./desempenho-vendas.js";
import { ator, DiaDoCalendario, erroDoErp, recusaDeValidacao, SEM_CONEXAO, Version, versaoDesatualizada, type AuthContext, type ErpQuery } from "./metas-comum.js";
import { PEDIDOS_PLUGIN } from "./pedidos-audit.js";
import { PEDIDOS_MINIMOS_ACTION, PEDIDOS_MINIMOS_TARGET } from "./pedidos-minimos-audit.js";
import type { MinimoMaximoStore } from "./pedidos-minimos-store.js";
import type { AuditService } from "./vinculo-audit.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { COLUNA_DO_PRODUTO, idsPorTipo } from "./lista-produtos.js";
import { EntradaLista, idValido } from "./tipos-meta.js";
import { aChegarPorLinha, chaveDaLinha, conferir } from "./pedidos-conferencia.js";
import { entradasDosPedidos } from "./pedidos-nf.js";
import type { PedidoStore } from "./pedidos-store.js";
import { lojasDoErp } from "./pre-vencidos-comum.js";

export interface PedidosLancamentoRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
  minimos: MinimoMaximoStore;
  /** Os Pedidos do Celestia: os confirmados e ainda não recebidos por inteiro alimentam a coluna a chegar. */
  pedidos: PedidoStore;
  audit: AuditService;
}

const VER = INOVAFARMA_PERMISSIONS.ref("pedidos-lancamento:ver");
const EDITAR_MINIMOS = INOVAFARMA_PERMISSIONS.ref("pedidos-minimos:editar");
const MINIMOS_DESATUALIZADOS = versaoDesatualizada("O estoque mínimo foi alterado por outra pessoa. A grade foi recarregada.");
const BASE = "/pedidos/lancamento";
/** Meses da movimentação do produto, contando o atual. */
const MESES_DA_MOVIMENTACAO = 12;

const Lojas = z
  .string()
  .regex(/^\d+(,\d+)*$/, "Parâmetro 'lojas' deve ser uma lista de códigos separados por vírgula.")
  .transform((v) => v.split(",").map(Number))
  .optional();
const ID_INVALIDO = "Uma entrada do Filtro de produtos tem um identificador inválido.";
/** O "Filtro de produtos": as entradas (Produto, Grupo, Seção, Laboratório) em JSON na query, com o id validado pelo tipo. */
const Entradas = z
  .string()
  .max(60_000)
  .transform((v, ctx) => {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Parâmetro 'entradas' deve ser um JSON válido." });
      return z.NEVER;
    }
  })
  .pipe(z.array(EntradaLista.pick({ tipo: true, id: true }).refine(idValido, ID_INVALIDO)).max(500))
  .optional();
const MENSAGEM_DATA = "Informe a data no formato AAAA-MM-DD.";

const ConsultaProdutos = z
  .object({
    modo: z.enum(["periodo", "apartir"], "Parâmetro 'modo' deve ser 'periodo' ou 'apartir'."),
    de: DiaDoCalendario(MENSAGEM_DATA),
    ate: DiaDoCalendario(MENSAGEM_DATA).optional(),
    lojas: Lojas,
    entradas: Entradas,
    apenasMinimo: z.enum(["1"]).optional(),
  })
  .refine((q) => q.modo === "apartir" || q.ate !== undefined, { error: "Informe a data final do período.", path: ["ate"] })
  .refine((q) => q.ate === undefined || q.modo === "apartir" || q.de <= q.ate, { error: "A data final não pode ser anterior à data inicial.", path: ["ate"] });

const Quantidade = z.number().min(0, "Informe um valor maior ou igual a zero.").max(1_000_000_000);
const EdicaoMinimo = z
  .object({ produtoId: z.string().min(1, "Informe o produto.").max(36), codigoLoja: z.number().int().min(1), minimo: Quantidade, maximo: Quantidade.nullable(), version: Version.or(z.literal(0)) })
  .refine((e) => e.maximo === null || e.maximo >= e.minimo, { error: "O máximo não pode ser menor que o mínimo.", path: ["maximo"] });

const MAX_PRODUTOS_ENTRADAS = 200;
const ConsultaEntradas = z.object({
  produtoIds: z
    .string()
    .min(1, "Informe os produtos.")
    .transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(z.string().min(1).max(36)).min(1, "Informe os produtos.").max(MAX_PRODUTOS_ENTRADAS, "Produtos demais na consulta.")),
});

const ConsultaUltimasCompras = z.object({ produtoId: z.string().min(1, "Informe o produto.").max(36) });

const ConsultaMovimentacao = z.object({ produtoId: z.string().min(1, "Informe o produto.").max(36), lojas: Lojas });

interface LinhaVenda {
  produtoId: string;
  codigoProduto: number | null;
  nome: string | null;
  codigoBarra: string | null;
  fabricante: string | null;
  formula: string | null;
  grupo: string | null;
  secao: string | null;
  codigoLoja: number;
  vendida: number | null;
  estoque: number | null;
}

interface LojaLancamento {
  codigoLoja: number;
  vendida: number;
  estoque: number;
  minimo: number | null;
  maximo: number | null;
  sugestao: number;
  /** Pedido aberto menos as entradas de NF. */
  aChegar: number;
  /** 0 enquanto a Loja não tem mínimo/máximo gravado. */
  version: number;
}

interface ProdutoLancamento {
  produtoId: string;
  codigoProduto: number | null;
  nome: string;
  codigoBarra: string | null;
  fabricante: string;
  formula: string;
  grupo: string;
  secao: string;
  vendida: number;
  estoque: number;
  minimo: number;
  sugestao: number;
  aChegar: number;
  lojas: LojaLancamento[];
}

interface LinhaMes {
  mes: string;
  vendida: number | null;
  comprada: number | null;
}

/** Os códigos de Loja por parâmetro (`@loja0`…); sem Lojas, todas. */
function filtroDeLojas(coluna: string, lojas: number[] | undefined, params: Record<string, unknown>): string {
  if (!lojas?.length) return "";
  lojas.forEach((codigo, i) => {
    params[`loja${i}`] = codigo;
  });
  return `AND ${coluna} IN (${lojas.map((_, i) => `@loja${i}`).join(", ")})`;
}

/**
 * Vendas do período por produto e Loja (regras da Venda Líquida), com o estoque atual da Loja. Os filtros entram por
 * parâmetro, nunca no SQL.
 */
const produtosSql = (filtroVenda: string) => `
  SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, p.CodigoProduto AS codigoProduto, LTRIM(RTRIM(p.NomeProduto)) AS nome, p.CodigoBarra AS codigoBarra,
         LTRIM(RTRIM(fa.NomeFabricante)) AS fabricante, LTRIM(RTRIM(fo.NomeFormula)) AS formula, LTRIM(RTRIM(gr.NomeGrupo)) AS grupo, LTRIM(RTRIM(se.NomeSessao)) AS secao,
         g.codigoLoja AS codigoLoja, g.vendida AS vendida,
         CAST((SELECT TOP 1 pe.Estoque FROM Produto_Estoque pe WHERE pe.CodigoProduto = g.codigoProduto AND pe.CodigoEmpresa = g.codigoLoja) AS float) AS estoque
  FROM (
    SELECT vp.CodigoProduto AS codigoProduto, v.CodigoEmpresa AS codigoLoja, CAST(SUM(vp.Quantidade) AS float) AS vendida
    ${vendasFromWhere(filtroVenda)}
    GROUP BY vp.CodigoProduto, v.CodigoEmpresa
  ) g
  JOIN Produto p ON p.CodigoProduto = g.codigoProduto
  LEFT JOIN Produto_Fabricante fa ON fa.CodigoFabricante = p.CodigoFabricante
  LEFT JOIN Produto_Formula fo ON fo.CodigoFormula = p.CodigoFormula
  LEFT JOIN Produto_Grupo gr ON gr.CodigoGrupo = p.CodigoGrupo
  LEFT JOIN Produto_Sessao se ON se.CodigoSessao = p.CodigoSessao
  ORDER BY p.NomeProduto, g.codigoLoja
`;

/** Vendas e compras (entradas de NF) do produto por mês, na janela de `@dataInicio` a `@dataFim`. */
const movimentacaoSql = (filtroVenda: string, filtroCompra: string) => `
  SELECT mes, CAST(SUM(vendida) AS float) AS vendida, CAST(SUM(comprada) AS float) AS comprada
  FROM (
    SELECT CONVERT(varchar(7), v.DataVenda, 120) AS mes, vp.Quantidade AS vendida, NULL AS comprada
    ${vendasFromWhere(filtroVenda)}
    UNION ALL
    SELECT CONVERT(varchar(7), c.DataNota, 120) AS mes, NULL AS vendida, ${UNIDADES_COMPRADAS} AS comprada
    FROM Compra c
    JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
    JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
    WHERE c.Eliminado = 0 AND c.DataNota >= @dataInicio AND c.DataNota <= @dataFim
      AND CONVERT(varchar(36), p.rowguid) = @produtoId
      ${filtroCompra}
  ) m
  GROUP BY mes
  ORDER BY mes
`;

/** Quantas distribuidoras (as de entrada mais recente) a janela de uma Loja já traz preenchidas. */
const MAX_ENTRADAS_POR_LOJA = 3;
/** As distribuidoras que já deram entrada de NF nos produtos (todo o histórico), por Loja, a mais recente primeiro. */
const entradasSql = (produtos: string) => `
  SELECT produtoId, codigoLoja, codigoFornecedor
  FROM (
    SELECT x.produtoId, x.codigoLoja, x.codigoFornecedor, ROW_NUMBER() OVER (PARTITION BY x.produtoId, x.codigoLoja ORDER BY x.ultima DESC) AS n
    FROM (
      SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, c.CodigoEmpresa AS codigoLoja, f.CodigoFornecedor AS codigoFornecedor, MAX(c.DataNota) AS ultima
      FROM Compra c
      JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
      JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
      JOIN Fornecedor f ON f.CodigoCadastro = c.CodigoCadastro
      WHERE c.Eliminado = 0 AND CONVERT(varchar(36), p.rowguid) IN (${produtos})
      GROUP BY CONVERT(varchar(36), p.rowguid), c.CodigoEmpresa, f.CodigoFornecedor
    ) x
  ) y
  WHERE y.n <= ${MAX_ENTRADAS_POR_LOJA}
  ORDER BY y.produtoId, y.codigoLoja, y.n`;

/** O valor unitário da última compra (entrada de NF) do produto em cada Loja. */
const ULTIMAS_COMPRAS_SQL = `
  SELECT codigoLoja, CAST(preco AS float) AS preco
  FROM (
    SELECT c.CodigoEmpresa AS codigoLoja, ${PRECO_POR_UNIDADE} AS preco, ROW_NUMBER() OVER (PARTITION BY c.CodigoEmpresa ORDER BY c.DataNota DESC, c.CodigoCompra DESC) AS n
    FROM Compra c
    JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
    JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
    WHERE c.Eliminado = 0 AND CONVERT(varchar(36), p.rowguid) = @produtoId
  ) x
  WHERE x.n = 1`;

/** O estoque atual do produto em cada Loja, tenha ou não venda no período. */
const ESTOQUES_SQL = `
  SELECT pe.CodigoEmpresa AS codigoLoja, CAST(pe.Estoque AS float) AS estoque
  FROM Produto_Estoque pe
  JOIN Produto p ON p.CodigoProduto = pe.CodigoProduto
  WHERE CONVERT(varchar(36), p.rowguid) = @produtoId`;

/** Nome para o Audit Log; se o ERP falhar, o que se tem (o código), sem barrar a gravação. */
async function nomeDoProduto(client: ErpQuery | undefined, produtoId: string): Promise<string> {
  try {
    const [r] = (await client?.query<{ nome: string | null }>("SELECT LTRIM(RTRIM(p.NomeProduto)) AS nome FROM Produto p WHERE CONVERT(varchar(36), p.rowguid) = @produtoId", { produtoId })) ?? [];
    return r?.nome?.trim() || produtoId;
  } catch {
    return produtoId;
  }
}

async function nomeDaLoja(client: ErpQuery | undefined, codigo: number): Promise<string | null> {
  try {
    return client ? ((await lojasDoErp(client)).find((l) => l.codigo === codigo)?.nome ?? null) : null;
  } catch {
    return null;
  }
}

/** Pedido aberto menos as entradas de NF (`produtoId|codigoLoja` -> quantidade), somado entre os Pedidos confirmados ou parcialmente recebidos. */
async function aChegarDosPedidos(client: ErpQuery, pedidos: PedidoStore): Promise<Map<string, number>> {
  const total = new Map<string, number>();
  const abertos = (await pedidos.listar()).filter((p) => p.status === "confirmado" || p.status === "parcialmente_recebido");
  const entradas = await entradasDosPedidos(client, abertos);
  for (const pedido of abertos) {
    for (const [chave, falta] of aChegarPorLinha(conferir(pedido, entradas.get(pedido) ?? new Map()))) total.set(chave, (total.get(chave) ?? 0) + falta);
  }
  return total;
}

/** `AAAA-MM-DD` de hoje na hora do ERP. */
const hojeNoErp = () => horaDoErp(new Date().toISOString()).slice(0, 10);
const diaAnterior = (dia: string) => new Date(Date.parse(`${dia}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Lançamento de Pedidos: filtros, grade de produtos por Loja e movimentação mensal. Só leitura no ERP. */
export function registerPedidosLancamentoRoutes({ routes, permissions, auth, erpClient, minimos, audit, pedidos }: PedidosLancamentoRoutesDeps): void {
  const recusa = (c: AuthContext) => (permissions.has(c.get("user")?.permissions, VER.key) ? null : c.json({ error: VER.deniedMessage }, 403));

  routes.get(`${BASE}/contexto`, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const lojas = await lojasDoErp(client);
      const hoje = hojeNoErp();
      return c.json({ hoje, ontem: diaAnterior(hoje), podeEditarMinimos: permissions.has(c.get("user")?.permissions, EDITAR_MINIMOS.key), lojas });
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });

  routes.get(`${BASE}/produtos`, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const consulta = ConsultaProdutos.safeParse(c.req.query());
    if (!consulta.success) return recusaDeValidacao(c, consulta.error);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    const { modo, de, entradas: filtroEntradas, lojas, apenasMinimo } = consulta.data;
    const ate = modo === "apartir" ? hojeNoErp() : (consulta.data.ate ?? de);
    const params: Record<string, unknown> = { dataInicio: `${de} 00:00:00`, dataFim: `${ate} 23:59:59` };
    const filtros = [filtroDeLojas("v.CodigoEmpresa", lojas, params)];
    // As entradas do Filtro de produtos são
    // unidas por OU, como nas colunas do Desempenho de Vendas: o produto casa com qualquer entrada.
    if (filtroEntradas?.length) {
      const condicoes = idsPorTipo(filtroEntradas, params, "ent").map(([tipo, nomes]) => `${COLUNA_DO_PRODUTO[tipo]} IN (${nomes})`);
      filtros.push(`AND (${condicoes.join(" OR ")})`);
    }
    try {
      const linhas = await client.query<LinhaVenda>(produtosSql(filtros.join(" ")), params);
      const definidos = new Map((await minimos.listar()).map((m) => [`${m.produtoId}|${m.codigoLoja}`, m]));
      const chegando = await aChegarDosPedidos(client, pedidos);
      const porProduto = new Map<string, ProdutoLancamento>();
      for (const l of linhas) {
        const vendida = Number(l.vendida) || 0;
        const estoque = Number(l.estoque) || 0;
        const definido = definidos.get(`${l.produtoId}|${l.codigoLoja}`);
        // Sugestão: só apoio ao comprador, nunca negativa.
        const loja = { codigoLoja: Number(l.codigoLoja), vendida, estoque, minimo: definido?.minimo ?? null, maximo: definido?.maximo ?? null, sugestao: Math.max(0, vendida + (definido?.minimo ?? 0) - estoque), aChegar: chegando.get(chaveDaLinha(l.produtoId, Number(l.codigoLoja))) ?? 0, version: definido?.version ?? 0 };
        const produto = porProduto.get(l.produtoId) ?? { produtoId: l.produtoId, codigoProduto: l.codigoProduto == null ? null : Number(l.codigoProduto), nome: (l.nome ?? "").trim(), codigoBarra: l.codigoBarra, fabricante: l.fabricante ?? "", formula: l.formula ?? "", grupo: l.grupo ?? "", secao: l.secao ?? "", vendida: 0, estoque: 0, minimo: 0, sugestao: 0, aChegar: 0, lojas: [] };
        produto.vendida += vendida;
        produto.estoque += estoque;
        produto.minimo += loja.minimo ?? 0;
        produto.sugestao += loja.sugestao;
        produto.aChegar += loja.aChegar;
        produto.lojas.push(loja);
        porProduto.set(l.produtoId, produto);
      }
      // A Loja com mínimo gravado mas sem venda no período não vem do ERP: entra com o que está gravado (e a version dele),
      // senão a grade a mostraria vazia e a próxima edição seria recusada como conflito.
      for (const produto of porProduto.values()) {
        for (const d of definidos.values()) {
          if (d.produtoId !== produto.produtoId || produto.lojas.some((l) => l.codigoLoja === d.codigoLoja)) continue;
          if (lojas && lojas.length > 0 && !lojas.includes(d.codigoLoja)) continue;
          produto.lojas.push({ codigoLoja: d.codigoLoja, vendida: 0, estoque: 0, minimo: d.minimo, maximo: d.maximo, sugestao: Math.max(0, d.minimo), aChegar: chegando.get(chaveDaLinha(d.produtoId, d.codigoLoja)) ?? 0, version: d.version });
          produto.minimo += d.minimo;
          produto.sugestao += Math.max(0, d.minimo);
          produto.aChegar += chegando.get(chaveDaLinha(d.produtoId, d.codigoLoja)) ?? 0;
        }
      }
      const todos = [...porProduto.values()];
      return c.json(apenasMinimo ? todos.filter((p) => p.lojas.some((l) => (l.minimo ?? 0) > 0)) : todos);
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });

  routes.get(`${BASE}/estoques`, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const produtoId = c.req.query("produtoId") ?? "";
    if (!produtoId || produtoId.length > 36) return c.json({ error: "Informe o produto." }, 400);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const linhas = await client.query<{ codigoLoja: number; estoque: number | null }>(ESTOQUES_SQL, { produtoId });
      return c.json(linhas.map((l) => ({ codigoLoja: Number(l.codigoLoja), estoque: Number(l.estoque) || 0 })));
    } catch (err: unknown) {
      return c.json(erroDoErp(err), 503);
    }
  });

  routes.get(`${BASE}/movimentacao`, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const consulta = ConsultaMovimentacao.safeParse(c.req.query());
    if (!consulta.success) return recusaDeValidacao(c, consulta.error);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    const { produtoId, lojas } = consulta.data;
    const hoje = hojeNoErp();
    const [ano = 0, mes = 1] = hoje.split("-").map(Number);
    const inicio = new Date(Date.UTC(ano, mes - MESES_DA_MOVIMENTACAO, 1)).toISOString().slice(0, 10);
    const params: Record<string, unknown> = { dataInicio: `${inicio} 00:00:00`, dataFim: `${hoje} 23:59:59`, produtoId };
    const filtroVenda = `AND CONVERT(varchar(36), p.rowguid) = @produtoId ${filtroDeLojas("v.CodigoEmpresa", lojas, params)}`;
    const filtroCompra = filtroDeLojas("c.CodigoEmpresa", lojas, params);
    try {
      const linhas = await client.query<LinhaMes>(movimentacaoSql(filtroVenda, filtroCompra), params);
      return c.json(linhas.map((l) => ({ mes: l.mes, vendida: Number(l.vendida) || 0, comprada: Number(l.comprada) || 0 })));
    } catch (err: unknown) {
      // A tela só mostra "ERP indisponível"; o motivo real (ex.: coluna inexistente) fica no log do servidor.
      console.error("Pedidos: falha na movimentação mensal do ERP.", err);
      return c.json(erroDoErp(err), 503);
    }
  });

  routes.get(`${BASE}/ultimas-compras`, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const consulta = ConsultaUltimasCompras.safeParse(c.req.query());
    if (!consulta.success) return recusaDeValidacao(c, consulta.error);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const linhas = await client.query<{ codigoLoja: number; preco: number | null }>(ULTIMAS_COMPRAS_SQL, { produtoId: consulta.data.produtoId });
      return c.json(linhas.map((l) => ({ codigoLoja: Number(l.codigoLoja), preco: Number(l.preco) || 0 })));
    } catch (err: unknown) {
      console.error("Pedidos: falha na última compra do ERP.", err);
      return c.json(erroDoErp(err), 503);
    }
  });

  routes.get(`${BASE}/entradas`, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const consulta = ConsultaEntradas.safeParse(c.req.query());
    if (!consulta.success) return recusaDeValidacao(c, consulta.error);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    const { produtoIds } = consulta.data;
    const params: Record<string, unknown> = {};
    produtoIds.forEach((id, i) => {
      params[`p${i}`] = id;
    });
    try {
      const linhas = await client.query<{ produtoId: string; codigoLoja: number; codigoFornecedor: number }>(entradasSql(produtoIds.map((_, i) => `@p${i}`).join(", ")), params);
      return c.json(linhas.map((l) => ({ produtoId: l.produtoId, codigoLoja: Number(l.codigoLoja), codigoFornecedor: Number(l.codigoFornecedor) })));
    } catch (err: unknown) {
      console.error("Pedidos: falha nas entradas de NF do ERP.", err);
      return c.json(erroDoErp(err), 503);
    }
  });

  routes.put(`${BASE}/minimos`, auth, async (c: AuthContext) => {
    if (!permissions.has(c.get("user")?.permissions, EDITAR_MINIMOS.key)) return c.json({ error: EDITAR_MINIMOS.deniedMessage }, 403);
    const lido = EdicaoMinimo.safeParse(await c.req.json().catch(() => null));
    if (!lido.success) return recusaDeValidacao(c, lido.error);
    const { produtoId, codigoLoja, version, ...valores } = lido.data;
    const anterior = (await minimos.listar()).find((m) => m.produtoId === produtoId && m.codigoLoja === codigoLoja) ?? null;
    const gravado = await minimos.definir(produtoId, codigoLoja, valores, version);
    if (!gravado) return c.json(MINIMOS_DESATUALIZADOS, 409);
    const client = erpClient();
    const [produto, nomeLoja] = await Promise.all([nomeDoProduto(client, produtoId), nomeDaLoja(client, codigoLoja)]);
    await audit.record({
      plugin: PEDIDOS_PLUGIN,
      action: PEDIDOS_MINIMOS_ACTION,
      actor: ator(c),
      target: { type: PEDIDOS_MINIMOS_TARGET, id: `${produtoId}:${codigoLoja}` },
      attributes: { ...valores, produto, codigoLoja, nomeLoja, anterior: anterior && { minimo: anterior.minimo, maximo: anterior.maximo } },
    });
    return c.json(gravado);
  });
}
