import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { ModuleContext } from "@platform/core/module";
import { horaDoErp } from "./baixas-da-loja.js";
import { nomesSql } from "./cotacao-routes.js";
import { vendasFromWhere } from "./desempenho-vendas.js";
import { erroDoErp, recusaDeValidacao, SEM_CONEXAO, type AuthContext, type ErpQuery } from "./metas-comum.js";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";

export interface PedidosEstudoRoutesDeps {
  routes: ModuleContext["routes"];
  permissions: ModuleContext["permissions"];
  auth: MiddlewareHandler;
  erpClient: () => ErpQuery | undefined;
}

const VER = INOVAFARMA_PERMISSIONS.ref("pedidos-lancamento:ver");
/** Meses do estudo, contando o atual. */
const MESES_DO_ESTUDO = 24;
const Consulta = z.object({ produtoId: z.string().min(1, "Informe o produto.").max(36) });

export interface VendaDoMes {
  mes: string;
  codigoLoja: number;
  vendida: number;
}
export interface CompraDoMes {
  mes: string;
  codigoLoja: number;
  codigoFornecedor: number;
  fornecedor: string;
  quantidade: number;
  /** Valor total das NFs do mês (preço unitário x quantidade). */
  valor: number;
}

const vendasSql = (filtroVenda: string) => `
  SELECT mes, codigoLoja, CAST(SUM(vendida) AS float) AS vendida
  FROM (
    SELECT CONVERT(varchar(7), v.DataVenda, 120) AS mes, v.CodigoEmpresa AS codigoLoja, vp.Quantidade AS vendida
    ${vendasFromWhere(filtroVenda)}
  ) m
  GROUP BY mes, codigoLoja
  ORDER BY mes, codigoLoja
`;

/** As entradas de NF do produto por mês, Loja e distribuidora, com a quantidade e o valor. */
const COMPRAS_SQL = `
  SELECT CONVERT(varchar(7), c.DataNota, 120) AS mes, c.CodigoEmpresa AS codigoLoja, f.CodigoFornecedor AS codigoFornecedor,
         CAST(SUM(cp.Quantidade) AS float) AS quantidade, CAST(SUM(cp.Quantidade * cp.Preco) AS float) AS valor
  FROM Compra c
  JOIN Compra_Produto cp ON cp.CodigoCompra = c.CodigoCompra
  JOIN Produto p ON p.CodigoProduto = cp.CodigoProduto
  JOIN Fornecedor f ON f.CodigoCadastro = c.CodigoCadastro
  WHERE c.Eliminado = 0 AND c.DataNota >= @dataInicio AND c.DataNota <= @dataFim
    AND CONVERT(varchar(36), p.rowguid) = @produtoId
  GROUP BY CONVERT(varchar(7), c.DataNota, 120), c.CodigoEmpresa, f.CodigoFornecedor
  ORDER BY mes, codigoLoja, codigoFornecedor
`;

async function nomesDosFornecedores(client: ErpQuery, codigos: number[]): Promise<Map<number, string>> {
  const nomes = new Map<number, string>();
  if (!codigos.length) return nomes;
  const params = Object.fromEntries(codigos.map((c, i) => [`c${i}`, c]));
  for (const r of await client.query<{ codigo: number; nome: string | null }>(nomesSql(codigos.length), params)) nomes.set(Number(r.codigo), r.nome?.trim() || `Fornecedor ${r.codigo}`);
  return nomes;
}

/** Estudo de produto: vendas por Loja e compras por distribuidora dos últimos meses. Só leitura no ERP; cada bloco falha sozinho (`null`). */
export function registerPedidosEstudoRoutes({ routes, permissions, auth, erpClient }: PedidosEstudoRoutesDeps): void {
  routes.get("/pedidos/lancamento/estudo", auth, async (c: AuthContext) => {
    if (!permissions.has(c.get("user")?.permissions, VER.key)) return c.json({ error: VER.deniedMessage }, 403);
    const consulta = Consulta.safeParse(c.req.query());
    if (!consulta.success) return recusaDeValidacao(c, consulta.error);
    const client = erpClient();
    if (!client) return c.json({ error: SEM_CONEXAO }, 503);
    const { produtoId } = consulta.data;
    const hoje = horaDoErp(new Date().toISOString()).slice(0, 10);
    const [ano = 0, mes = 1] = hoje.split("-").map(Number);
    const inicio = new Date(Date.UTC(ano, mes - MESES_DO_ESTUDO, 1)).toISOString().slice(0, 10);
    const params = { dataInicio: `${inicio} 00:00:00`, dataFim: `${hoje} 23:59:59`, produtoId };

    const vendas = async (): Promise<VendaDoMes[]> => {
      const linhas = await client.query<{ mes: string; codigoLoja: number; vendida: number | null }>(vendasSql("AND CONVERT(varchar(36), p.rowguid) = @produtoId"), params);
      return linhas.map((l) => ({ mes: l.mes, codigoLoja: Number(l.codigoLoja), vendida: Number(l.vendida) || 0 }));
    };
    const compras = async (): Promise<CompraDoMes[]> => {
      const linhas = await client.query<{ mes: string; codigoLoja: number; codigoFornecedor: number; quantidade: number | null; valor: number | null }>(COMPRAS_SQL, params);
      const nomes = await nomesDosFornecedores(client, [...new Set(linhas.map((l) => Number(l.codigoFornecedor)))]);
      return linhas.map((l) => ({
        mes: l.mes,
        codigoLoja: Number(l.codigoLoja),
        codigoFornecedor: Number(l.codigoFornecedor),
        fornecedor: nomes.get(Number(l.codigoFornecedor)) ?? `Fornecedor ${l.codigoFornecedor}`,
        quantidade: Number(l.quantidade) || 0,
        valor: Number(l.valor) || 0,
      }));
    };
    const [v, k] = await Promise.allSettled([vendas(), compras()]);
    if (v.status === "rejected" && k.status === "rejected") {
      console.error("Pedidos: falha no estudo de produto do ERP.", v.reason);
      return c.json(erroDoErp(v.reason), 503);
    }
    for (const r of [v, k]) if (r.status === "rejected") console.error("Pedidos: falha num bloco do estudo de produto.", r.reason);
    return c.json({ hoje, vendas: v.status === "fulfilled" ? v.value : null, compras: k.status === "fulfilled" ? k.value : null });
  });
}
