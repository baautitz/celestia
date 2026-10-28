import type { Context, MiddlewareHandler } from "hono";
import { defineModule, type ModuleDef } from "@platform/core/module";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { INOVAFARMA_EXTERNALS } from "./externals.js";
import { createInovafarmaDriver } from "./driver.js";

export { INOVAFARMA_PERMISSIONS, INOVAFARMA_EXTERNALS, createInovafarmaDriver };

export interface ErpQueryClient {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
  healthCheck?(): Promise<boolean>;
}

export interface InovafarmaPluginDeps {
  /** Middleware de autenticação injetado pelo servidor. */
  auth: MiddlewareHandler;
  /** Clientes de ERP ativos por ID; o InovaFarma utiliza a conexão com id `erpId`. */
  erpClients?: Record<string, ErpQueryClient | undefined>;
  /** ID do ERP configurado no módulo central de ERPs (padrão: "inovafarma"). */
  erpId?: string;
}

/**
 * Plugin InovaFarma: módulo cliente que consome a conexão MSSQL gerenciada pela plataforma
 * e expõe rotas de consulta baseadas nos identificadores externos (codigoColaborador, codigoLoja).
 */
export function createInovafarmaPlugin({ auth, erpClients = {}, erpId = "inovafarma" }: InovafarmaPluginDeps): ModuleDef {
  return defineModule({
    id: "inovafarma",
    version: "1.0.0",
    permissions: INOVAFARMA_PERMISSIONS,
    register({ routes, permissions }) {
      const viewKey = INOVAFARMA_PERMISSIONS.keys["integration:view"];

      routes.get("/status", auth, async (c: Context<{ Variables: { user?: { permissions?: string[] } } }>) => {
        const user = c.get("user");
        if (!permissions.has(user?.permissions, viewKey)) {
          return c.json({ error: INOVAFARMA_PERMISSIONS.items[0]?.deniedMessage ?? "Acesso negado." }, 403);
        }

        const client = erpClients[erpId];
        const isHealthy = client?.healthCheck ? await client.healthCheck() : Boolean(client);

        return c.json({
          module: "inovafarma",
          connected: Boolean(client),
          healthy: isHealthy,
          erpId,
          externals: INOVAFARMA_EXTERNALS,
        });
      });

      routes.get("/lojas", auth, async (c: Context<{ Variables: { user?: { permissions?: string[] } } }>) => {
        const user = c.get("user");
        if (!permissions.has(user?.permissions, viewKey)) {
          return c.json({ error: INOVAFARMA_PERMISSIONS.items[0]?.deniedMessage ?? "Acesso negado." }, 403);
        }

        const client = erpClients[erpId];
        if (!client) return c.json([]);

        try {
          const sql = `
            SELECT CodigoEmpresa AS codigoEmpresa, NomeFilial AS nome
            FROM Config
            WHERE NomeFilial IS NOT NULL AND LTRIM(RTRIM(NomeFilial)) <> ''
            ORDER BY CodigoEmpresa
          `;
          const rows = await client.query<{ codigoEmpresa: number; nome: string }>(sql);
          return c.json(rows.map((r) => ({ codigoEmpresa: Number(r.codigoEmpresa), nome: (r.nome || "").trim() })));
        } catch {
          return c.json([]);
        }
      });

      routes.get("/relatorios/vendas-colaborador", auth, async (c: Context<{ Variables: { user?: { permissions?: string[] } } }>) => {
        const user = c.get("user");
        if (!permissions.has(user?.permissions, viewKey)) {
          return c.json({ error: INOVAFARMA_PERMISSIONS.items[0]?.deniedMessage ?? "Acesso negado." }, 403);
        }

        const client = erpClients[erpId];
        if (!client) {
          return c.json({ error: "Conexão com ERP InovaFarma não configurada ou inativa." }, 503);
        }

        const dataInicio = c.req.query("dataInicio") || "";
        const dataFim = c.req.query("dataFim") || "";
        const codigoEmpresa = c.req.query("codigoEmpresa");

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dataInicio) || !dateRegex.test(dataFim)) {
          return c.json({ error: "Parâmetros 'dataInicio' e 'dataFim' são obrigatórios no formato YYYY-MM-DD." }, 400);
        }

        const params: Record<string, unknown> = {
          dataInicio: `${dataInicio} 00:00:00`,
          dataFim: `${dataFim} 23:59:59`,
        };

        let filtroEmpresa = "";
        if (codigoEmpresa && !Number.isNaN(Number(codigoEmpresa))) {
          filtroEmpresa = "AND v.CodigoEmpresa = @codigoEmpresa";
          params.codigoEmpresa = Number(codigoEmpresa);
        }

        const fromWhere = `
          FROM Venda v
          JOIN Venda_Produto vp ON vp.CodigoVenda = v.CodigoVenda
          JOIN Funcionario f ON f.CodigoFuncionario = vp.CodigoFuncionario
          JOIN Cadastro c ON c.CodigoCadastro = f.CodigoCadastro
          WHERE v.Eliminado = 0
            AND v.DataVenda >= @dataInicio
            AND v.DataVenda <= @dataFim
            ${filtroEmpresa}
        `;

        const sql = `
          SELECT
            vp.CodigoFuncionario AS codigoColaborador,
            c.Nome AS nomeColaborador,
            COUNT(DISTINCT vp.CodigoVenda) AS quantidadeVendas,
            CAST(SUM(vp.Total + vp.TotalDesconto) AS float) AS totalBruto,
            CAST(SUM(vp.TotalDesconto) AS float) AS totalDesconto,
            CAST(SUM(vp.Total) AS float) AS totalLiquido,
            CAST(SUM(vp.Quantidade * vp.PrecoCusto) AS float) AS totalCmv,
            COUNT(DISTINCT CASE WHEN v.CodigoCadastro <> 0 THEN vp.CodigoVenda END) AS vendasComCadastro
          ${fromWhere}
          GROUP BY vp.CodigoFuncionario, c.Nome
          ORDER BY totalLiquido DESC
        `;

        // CodigoCadastro = 0 é o "CONSUMIDOR" (venda sem cliente cadastrado).
        // Uma venda com itens de vários Colaboradores conta em cada um; o total geral conta cada venda uma vez.
        const sqlTotalVendas = `
          SELECT
            COUNT(DISTINCT v.CodigoVenda) AS totalVendasGeral,
            COUNT(DISTINCT CASE WHEN v.CodigoCadastro <> 0 THEN v.CodigoVenda END) AS totalVendasComCadastro
          ${fromWhere}
        `;

        try {
          interface ColaboradorRow {
            codigoColaborador: number;
            nomeColaborador: string;
            quantidadeVendas: number;
            totalBruto: number;
            totalDesconto: number;
            totalLiquido: number;
            totalCmv: number;
            vendasComCadastro: number;
          }

          const [rows, [totalVendasRow]] = await Promise.all([
            client.query<ColaboradorRow>(sql, params),
            client.query<{ totalVendasGeral: number; totalVendasComCadastro: number }>(sqlTotalVendas, params),
          ]);

          const totalVendasGeral = Number(totalVendasRow?.totalVendasGeral) || 0;
          const totalVendasComCadastro = Number(totalVendasRow?.totalVendasComCadastro) || 0;
          const totalLiquidoGeral = rows.reduce((acc, r) => acc + (Number(r.totalLiquido) || 0), 0);
          const totalBrutoGeral = rows.reduce((acc, r) => acc + (Number(r.totalBruto) || 0), 0);
          const totalDescontoGeral = rows.reduce((acc, r) => acc + (Number(r.totalDesconto) || 0), 0);
          const totalCmvGeral = rows.reduce((acc, r) => acc + (Number(r.totalCmv) || 0), 0);

          return c.json({
            resumo: {
              totalVendasGeral,
              totalLiquidoGeral,
              totalBrutoGeral,
              totalDescontoGeral,
              totalCmvGeral,
              cmvPercentGeral: totalLiquidoGeral > 0 ? (totalCmvGeral / totalLiquidoGeral) * 100 : 0,
              cadastroPercentGeral: totalVendasGeral > 0 ? (totalVendasComCadastro / totalVendasGeral) * 100 : 0,
              totalColaboradores: rows.length,
            },
            colaboradores: rows.map((r) => {
              const liq = Number(r.totalLiquido) || 0;
              const qtd = Number(r.quantidadeVendas) || 0;
              const cmv = Number(r.totalCmv) || 0;
              return {
                codigoColaborador: Number(r.codigoColaborador),
                nomeColaborador: (r.nomeColaborador || "").trim(),
                quantidadeVendas: qtd,
                totalBruto: Number(r.totalBruto) || 0,
                totalDesconto: Number(r.totalDesconto) || 0,
                totalLiquido: liq,
                totalCmv: cmv,
                cmvPercent: liq > 0 ? (cmv / liq) * 100 : 0,
                ticketMedio: qtd > 0 ? liq / qtd : 0,
                participacaoPercent: totalLiquidoGeral > 0 ? (liq / totalLiquidoGeral) * 100 : 0,
                cadastroPercent: qtd > 0 ? ((Number(r.vendasComCadastro) || 0) / qtd) * 100 : 0,
              };
            }),
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Falha ao consultar banco InovaFarma.";
          return c.json({ error: msg }, 500);
        }
      });
    },
  });
}
