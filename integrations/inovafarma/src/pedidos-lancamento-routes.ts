import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { horaDoErp } from "./baixas-da-loja.js";
import { vendasFromWhere } from "./desempenho-vendas.js";
import { DiaDoCalendario, erroDoErp, recusaDeValidacao, SEM_CONEXAO, type AuthContext, type ErpQuery } from "./metas-comum.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { lojasDoErp } from "./pre-vencidos-comum.js";

export interface PedidosLancamentoRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
}

const VER = INOVAFARMA_PERMISSIONS.ref("pedidos-lancamento:ver");
const BASE = "/pedidos/lancamento";
/** Meses da movimentação do produto, contando o atual. */
const MESES_DA_MOVIMENTACAO = 12;

const OPCOES_SQL = {
  laboratorios: `
    SELECT CAST(f.CodigoFabricante AS varchar(10)) AS id, LTRIM(RTRIM(f.NomeFabricante)) AS nome
    FROM Produto_Fabricante f
    WHERE f.Eliminado = 0 AND UPPER(LTRIM(RTRIM(f.NomeFabricante))) <> 'REVISAR'
    ORDER BY f.NomeFabricante`,
  grupos: `
    SELECT CAST(g.CodigoGrupo AS varchar(10)) AS id, LTRIM(RTRIM(g.NomeGrupo)) AS nome
    FROM Produto_Grupo g
    WHERE g.Ativo = 1
    ORDER BY g.NomeGrupo`,
  secoes: `
    SELECT CAST(s.CodigoSessao AS varchar(10)) AS id, LTRIM(RTRIM(s.NomeSessao)) AS nome
    FROM Produto_Sessao s
    ORDER BY s.NomeSessao`,
} as const;

const Lojas = z
  .string()
  .regex(/^\d+(,\d+)*$/, "Parâmetro 'lojas' deve ser uma lista de códigos separados por vírgula.")
  .transform((v) => v.split(",").map(Number))
  .optional();
const CodigoOpcional = z.string().regex(/^\d+$/, "Código de filtro inválido.").transform(Number).optional();
const MENSAGEM_DATA = "Informe a data no formato AAAA-MM-DD.";

const ConsultaProdutos = z
  .object({
    modo: z.enum(["periodo", "apartir"], "Parâmetro 'modo' deve ser 'periodo' ou 'apartir'."),
    de: DiaDoCalendario(MENSAGEM_DATA),
    ate: DiaDoCalendario(MENSAGEM_DATA).optional(),
    lojas: Lojas,
    laboratorio: CodigoOpcional,
    grupo: CodigoOpcional,
    secao: CodigoOpcional,
  })
  .refine((q) => q.modo === "apartir" || q.ate !== undefined, { error: "Informe a data final do período.", path: ["ate"] })
  .refine((q) => q.ate === undefined || q.modo === "apartir" || q.de <= q.ate, { error: "A data final não pode ser anterior à data inicial.", path: ["ate"] });

const ConsultaMovimentacao = z.object({ produtoId: z.string().min(1, "Informe o produto.").max(36), lojas: Lojas });

interface LinhaVenda {
  produtoId: string;
  nome: string | null;
  codigoBarra: string | null;
  codigoLoja: number;
  vendida: number | null;
  estoque: number | null;
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
  SELECT CONVERT(varchar(36), p.rowguid) AS produtoId, LTRIM(RTRIM(p.NomeProduto)) AS nome, p.CodigoBarra AS codigoBarra,
         g.codigoLoja AS codigoLoja, g.vendida AS vendida,
         CAST((SELECT TOP 1 pe.Estoque FROM Produto_Estoque pe WHERE pe.CodigoProduto = g.codigoProduto AND pe.CodigoEmpresa = g.codigoLoja) AS float) AS estoque
  FROM (
    SELECT vp.CodigoProduto AS codigoProduto, v.CodigoEmpresa AS codigoLoja, CAST(SUM(vp.Quantidade) AS float) AS vendida
    ${vendasFromWhere(filtroVenda)}
    GROUP BY vp.CodigoProduto, v.CodigoEmpresa
  ) g
  JOIN Produto p ON p.CodigoProduto = g.codigoProduto
  ORDER BY p.NomeProduto, g.codigoLoja
`;

/** Vendas e compras (entradas de NF) do produto por mês, na janela de `@dataInicio` a `@dataFim`. */
const movimentacaoSql = (filtroVenda: string, filtroCompra: string) => `
  SELECT mes, CAST(SUM(vendida) AS float) AS vendida, CAST(SUM(comprada) AS float) AS comprada
  FROM (
    SELECT CONVERT(varchar(7), v.DataVenda, 120) AS mes, vp.Quantidade AS vendida, NULL AS comprada
    ${vendasFromWhere(filtroVenda)}
    UNION ALL
    SELECT CONVERT(varchar(7), c.DataEntrada, 120) AS mes, NULL AS vendida, cp.Quantidade AS comprada
    FROM Compra c
    JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
    JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
    WHERE c.Eliminado = 0 AND c.DataEntrada >= @dataInicio AND c.DataEntrada <= @dataFim
      AND CONVERT(varchar(36), p.rowguid) = @produtoId
      ${filtroCompra}
  ) m
  GROUP BY mes
  ORDER BY mes
`;

/** `AAAA-MM-DD` de hoje na hora do ERP. */
const hojeNoErp = () => horaDoErp(new Date().toISOString()).slice(0, 10);
const diaAnterior = (dia: string) => new Date(Date.parse(`${dia}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Lançamento de Pedidos: filtros, grade de produtos por Loja e movimentação mensal. Só leitura no ERP. */
export function registerPedidosLancamentoRoutes({ routes, permissions, auth, erpClient }: PedidosLancamentoRoutesDeps): void {
  const recusa = (c: AuthContext) => (permissions.has(c.get("user")?.permissions, VER.key) ? null : c.json({ error: VER.deniedMessage }, 403));

  routes.get(`${BASE}/contexto`, auth, async (c: AuthContext) => {
    const negado = recusa(c);
    if (negado) return negado;
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    try {
      const opcoes = async (sql: string) => (await client.query<{ id: string; nome: string | null }>(sql)).map((r) => ({ id: String(r.id), nome: (r.nome ?? "").trim() }));
      const [lojas, laboratorios, grupos, secoes] = await Promise.all([lojasDoErp(client), opcoes(OPCOES_SQL.laboratorios), opcoes(OPCOES_SQL.grupos), opcoes(OPCOES_SQL.secoes)]);
      const hoje = hojeNoErp();
      return c.json({ hoje, ontem: diaAnterior(hoje), lojas, laboratorios, grupos, secoes });
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
    const { modo, de, laboratorio, grupo, secao, lojas } = consulta.data;
    const ate = modo === "apartir" ? hojeNoErp() : (consulta.data.ate ?? de);
    const params: Record<string, unknown> = { dataInicio: `${de} 00:00:00`, dataFim: `${ate} 23:59:59` };
    const filtros = [filtroDeLojas("v.CodigoEmpresa", lojas, params)];
    for (const [valor, nome, coluna] of [[laboratorio, "laboratorio", "p.CodigoFabricante"], [grupo, "grupo", "p.CodigoGrupo"], [secao, "secao", "p.CodigoSessao"]] as const) {
      if (valor === undefined) continue;
      params[nome] = valor;
      filtros.push(`AND ${coluna} = @${nome}`);
    }
    try {
      const linhas = await client.query<LinhaVenda>(produtosSql(filtros.join(" ")), params);
      const porProduto = new Map<string, { produtoId: string; nome: string; codigoBarra: string | null; vendida: number; estoque: number; lojas: { codigoLoja: number; vendida: number; estoque: number }[] }>();
      for (const l of linhas) {
        const loja = { codigoLoja: Number(l.codigoLoja), vendida: Number(l.vendida) || 0, estoque: Number(l.estoque) || 0 };
        const produto = porProduto.get(l.produtoId) ?? { produtoId: l.produtoId, nome: (l.nome ?? "").trim(), codigoBarra: l.codigoBarra, vendida: 0, estoque: 0, lojas: [] };
        produto.vendida += loja.vendida;
        produto.estoque += loja.estoque;
        produto.lojas.push(loja);
        porProduto.set(l.produtoId, produto);
      }
      return c.json([...porProduto.values()]);
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
      return c.json(erroDoErp(err), 503);
    }
  });
}
