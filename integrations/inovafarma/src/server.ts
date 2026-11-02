import { resolve } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { defineModule, type ModuleDef } from "@platform/core/module";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { createInovafarmaDriver } from "./driver.js";
import { LOJAS_SQL, registerColaboradoresRoutes, type UsersService } from "./colaboradores-routes.js";
import { PostgresVinculoStore } from "./postgres-vinculo-store.js";
import { declareAvaliacaoAudit } from "./avaliacoes-audit.js";
import { registerAvaliacoesRoutes } from "./avaliacoes-routes.js";
import { MemoryAvaliacaoStore } from "./avaliacoes-store.js";
import { PostgresAvaliacaoStore } from "./postgres-avaliacao-store.js";
import { declareFuroEstoqueAudit } from "./furo-estoque-audit.js";
import { registerFuroEstoqueRoutes } from "./furo-estoque-routes.js";
import { MemoryFuroEstoqueStore } from "./furo-estoque-store.js";
import { PostgresFuroEstoqueStore } from "./postgres-furo-estoque-store.js";
import { declareTiposMetaAudit } from "./tipos-meta-audit.js";
import { declareMetasAudit } from "./metas-audit.js";
import { registerMetasRoutes } from "./metas-routes.js";
import { registerTiposMetaRoutes } from "./tipos-meta-routes.js";
import { MemoryTipoMetaStore } from "./tipos-meta-store.js";
import { MemoryMetaStore } from "./metas-store.js";
import { PostgresTipoMetaStore } from "./postgres-tipos-meta-store.js";
import { PostgresMetaStore } from "./postgres-meta-store.js";
import { declarePreVencidoAudit } from "./pre-vencidos-audit.js";
import { registerPreVencidosRoutes, type PeriodsService } from "./pre-vencidos-routes.js";
import { MemoryPreVencidoStore } from "./pre-vencidos-store.js";
import { PostgresPreVencidoStore } from "./postgres-pre-vencido-store.js";
import { declareVinculoAudit, type AuditService } from "./vinculo-audit.js";
import { MemoryVinculoStore } from "./vinculo-store.js";
import { CATEGORIAS, desempenhoSql, porCategoria, type CategoriaColuna, type CategoriaTotais } from "./desempenho-vendas.js";
import { SEM_VISUALIZACAO, VISUALIZACAO_PERMISSION, VISUALIZACOES, visualizacoesDoUsuario, type Visualizacao } from "./visualizacoes.js";

export { INOVAFARMA_PERMISSIONS, createInovafarmaDriver, PostgresVinculoStore };
export { UsuarioJaVinculadoError, VersaoDesatualizadaError } from "./vinculo-store.js";

/** Migrations do Plugin (schema Postgres "inovafarma"), na raiz do pacote: valem para `src` e para `dist`. */
export const INOVAFARMA_MIGRATIONS = { folder: resolve(import.meta.dirname, "../drizzle"), schema: "inovafarma" };

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
  /** Postgres do Celestia; sem ele os vínculos ficam em memória. */
  db?: NodePgDatabase;
}

/**
 * Plugin InovaFarma: módulo cliente que consome a conexão MSSQL gerenciada pela plataforma
 * e expõe rotas de consulta sobre os dados do ERP.
 */
export function createInovafarmaPlugin({ auth, erpClients = {}, erpId = "inovafarma", db }: InovafarmaPluginDeps): ModuleDef {
  return defineModule({
    id: "inovafarma",
    version: "1.0.0",
    dependsOn: ["iam", "audit", "closing_period"],
    permissions: INOVAFARMA_PERMISSIONS,
    migrations: INOVAFARMA_MIGRATIONS,
    register({ routes, permissions, services }) {
      const audit = services.use<AuditService>("audit", "log");
      declareVinculoAudit(audit);
      declarePreVencidoAudit(audit);
      declareAvaliacaoAudit(audit);
      declareFuroEstoqueAudit(audit);
      declareTiposMetaAudit(audit);
      declareMetasAudit(audit);
      const store = db ? new PostgresVinculoStore(db) : new MemoryVinculoStore();
      const users = services.use<UsersService>("iam", "users");
      const periods = services.use<PeriodsService>("closing_period", "periods");
      registerColaboradoresRoutes({
        routes,
        permissions,
        auth,
        erpClient: () => erpClients[erpId],
        store,
        users,
        audit,
      });
      registerPreVencidosRoutes({
        routes,
        permissions,
        auth,
        erpClient: () => erpClients[erpId],
        store: db ? new PostgresPreVencidoStore(db) : new MemoryPreVencidoStore(),
        vinculos: store,
        periods,
        audit,
      });
      registerAvaliacoesRoutes({
        routes,
        permissions,
        auth,
        erpClient: () => erpClients[erpId],
        store: db ? new PostgresAvaliacaoStore(db) : new MemoryAvaliacaoStore(),
        vinculos: store,
        users,
        periods,
        audit,
      });
      registerFuroEstoqueRoutes({
        routes,
        permissions,
        auth,
        erpClient: () => erpClients[erpId],
        store: db ? new PostgresFuroEstoqueStore(db) : new MemoryFuroEstoqueStore(),
        vinculos: store,
        users,
        periods,
        audit,
      });
      const tiposMeta = db ? new PostgresTipoMetaStore(db) : new MemoryTipoMetaStore();
      const metas = db ? new PostgresMetaStore(db) : new MemoryMetaStore();
      registerTiposMetaRoutes({ routes, permissions, auth, store: tiposMeta, metas, periods, audit });
      registerMetasRoutes({ routes, permissions, auth, erpClient: () => erpClients[erpId], tipos: tiposMeta, metas, vinculos: store, periods, audit });

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
          const rows = await client.query<{ codigoEmpresa: number; nome: string }>(LOJAS_SQL);
          return c.json(rows.map((r) => ({ codigoEmpresa: Number(r.codigoEmpresa), nome: (r.nome || "").trim() })));
        } catch {
          return c.json([]);
        }
      });

      type ReportContext = Context<{ Variables: { user?: { sub?: string; permissions?: string[] } } }>;

      /** Visualizações do Usuário: a Permission de cada uma e, para Loja e Individual, o vínculo do #53. */
      const visualizacoesDe = async (c: ReportContext) => {
        const user = c.get("user");
        const vinculo = user?.sub ? ((await store.list()).find((v) => v.usuarioId === user.sub) ?? null) : null;
        return visualizacoesDoUsuario(user?.permissions, vinculo, (p, k) => permissions.has(p, k));
      };

      const lojasDoErp = async (client: ErpQueryClient | undefined) => {
        if (!client) return [];
        try {
          const rows = await client.query<{ codigoEmpresa: number; nome: string }>(LOJAS_SQL);
          return rows.map((r) => ({ codigoEmpresa: Number(r.codigoEmpresa), nome: (r.nome || "").trim() }));
        } catch {
          return [];
        }
      };

      // A tela decide o que mostrar por aqui: Visualizações disponíveis e as Lojas que cada uma permite filtrar.
      routes.get("/relatorios/vendas-colaborador/visualizacoes", auth, async (c: ReportContext) => {
        const { disponiveis, lojas } = await visualizacoesDe(c);
        const lojasErp = disponiveis.some((v) => v !== "individual") ? await lojasDoErp(erpClients[erpId]) : [];
        const lojasDe = (v: Visualizacao) =>
          v === "geral" ? lojasErp : v === "loja" ? lojas.map((codigoEmpresa) => lojasErp.find((l) => l.codigoEmpresa === codigoEmpresa) ?? { codigoEmpresa, nome: "" }) : [];
        return c.json({ visualizacoes: disponiveis.map((id) => ({ id, lojas: lojasDe(id) })) });
      });

      routes.get("/relatorios/vendas-colaborador", auth, async (c: ReportContext) => {
        const { disponiveis, lojas: lojasVinculo, codigoColaborador } = await visualizacoesDe(c);
        if (disponiveis.length === 0) return c.json({ error: SEM_VISUALIZACAO }, 403);
        const pedida = c.req.query("visualizacao") ?? disponiveis[0];
        if (!VISUALIZACOES.includes(pedida as Visualizacao)) {
          return c.json({ error: "Parâmetro 'visualizacao' deve ser geral, loja ou individual." }, 400);
        }
        const visualizacao = pedida as Visualizacao;
        if (!disponiveis.includes(visualizacao)) {
          const item = INOVAFARMA_PERMISSIONS.items.find((i) => i.key === VISUALIZACAO_PERMISSION[visualizacao]);
          return c.json({ error: item?.deniedMessage ?? SEM_VISUALIZACAO }, 403);
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

        // Loja: toda venda feita nas Lojas do vínculo, de qualquer vendedor. Individual: toda venda do
        // Colaborador, em qualquer Loja: quem vendeu fora das suas Lojas continua no próprio Individual.
        let filtroEmpresa = "";
        const lojaPedida = codigoEmpresa && !Number.isNaN(Number(codigoEmpresa)) ? Number(codigoEmpresa) : null;
        if (visualizacao === "loja") {
          if (lojaPedida !== null && !lojasVinculo.includes(lojaPedida)) {
            return c.json({ error: "A Loja informada não está vinculada ao seu Colaborador." }, 403);
          }
          const permitidas = lojaPedida === null ? lojasVinculo : [lojaPedida];
          filtroEmpresa = `AND v.CodigoEmpresa IN (${permitidas.map((_, i) => `@loja${i}`).join(", ")})`;
          permitidas.forEach((codigo, i) => (params[`loja${i}`] = codigo));
        } else if (lojaPedida !== null) {
          filtroEmpresa = "AND v.CodigoEmpresa = @codigoEmpresa";
          params.codigoEmpresa = lojaPedida;
        }
        if (visualizacao === "individual") {
          filtroEmpresa += " AND vp.CodigoFuncionario = @codigoColaborador";
          params.codigoColaborador = codigoColaborador;
        }

        const { sql, sqlTotalVendas } = desempenhoSql(filtroEmpresa);

        try {
          type ColaboradorRow = Record<`qtd${CategoriaColuna}` | `valor${CategoriaColuna}`, number | null> & {
            codigoColaborador: number;
            nomeColaborador: string;
            quantidadeVendas: number;
            totalBruto: number;
            totalDesconto: number;
            totalLiquido: number;
            totalCmv: number;
            vendasComCadastro: number;
          };

          const categoriasDe = (r: ColaboradorRow): CategoriaTotais =>
            porCategoria((k) => {
              const { coluna } = CATEGORIAS[k];
              return { quantidade: Number(r[`qtd${coluna}`]) || 0, valor: Number(r[`valor${coluna}`]) || 0 };
            });

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
          const categoriasPorLinha = rows.map(categoriasDe);
          const categoriasGeral = porCategoria((k) => ({
            quantidade: categoriasPorLinha.reduce((acc, cat) => acc + cat[k].quantidade, 0),
            valor: categoriasPorLinha.reduce((acc, cat) => acc + cat[k].valor, 0),
          }));

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
              categorias: categoriasGeral,
            },
            colaboradores: rows.map((r, i) => {
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
                categorias: categoriasPorLinha[i],
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
