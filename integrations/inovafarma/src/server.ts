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

      routes.get("/relatorios/vendas-vendedor", auth, async (c: Context<{ Variables: { user?: { permissions?: string[] } } }>) => {
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

        const sql = `
          SELECT 
            v.CodigoFuncionario AS codigoFuncionario,
            c.Nome AS nomeFuncionario,
            COUNT(v.CodigoVenda) AS quantidadeVendas,
            CAST(SUM(v.TotalBruto) AS float) AS totalBruto,
            CAST(SUM(v.TotalDesconto) AS float) AS totalDesconto,
            CAST(SUM(v.TotalLiquido) AS float) AS totalLiquido
          FROM Venda v
          JOIN Funcionario f ON f.CodigoFuncionario = v.CodigoFuncionario
          JOIN Cadastro c ON c.CodigoCadastro = f.CodigoCadastro
          WHERE v.Eliminado = 0
            AND v.DataVenda >= @dataInicio
            AND v.DataVenda <= @dataFim
            ${filtroEmpresa}
          GROUP BY v.CodigoFuncionario, c.Nome
          ORDER BY totalLiquido DESC
        `;

        try {
          interface VendedorRow {
            codigoFuncionario: number;
            nomeFuncionario: string;
            quantidadeVendas: number;
            totalBruto: number;
            totalDesconto: number;
            totalLiquido: number;
          }

          const rows = await client.query<VendedorRow>(sql, params);

          const totalVendasGeral = rows.reduce((acc, r) => acc + (Number(r.quantidadeVendas) || 0), 0);
          const totalLiquidoGeral = rows.reduce((acc, r) => acc + (Number(r.totalLiquido) || 0), 0);
          const totalBrutoGeral = rows.reduce((acc, r) => acc + (Number(r.totalBruto) || 0), 0);
          const totalDescontoGeral = rows.reduce((acc, r) => acc + (Number(r.totalDesconto) || 0), 0);

          return c.json({
            resumo: {
              totalVendasGeral,
              totalLiquidoGeral,
              totalBrutoGeral,
              totalDescontoGeral,
              totalVendedores: rows.length,
            },
            vendedores: rows.map((r) => {
              const liq = Number(r.totalLiquido) || 0;
              const qtd = Number(r.quantidadeVendas) || 0;
              return {
                codigoFuncionario: Number(r.codigoFuncionario),
                nomeFuncionario: (r.nomeFuncionario || "").trim(),
                quantidadeVendas: qtd,
                totalBruto: Number(r.totalBruto) || 0,
                totalDesconto: Number(r.totalDesconto) || 0,
                totalLiquido: liq,
                ticketMedio: qtd > 0 ? liq / qtd : 0,
                participacaoPercent: totalLiquidoGeral > 0 ? (liq / totalLiquidoGeral) * 100 : 0,
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
