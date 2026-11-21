import { resolve } from "node:path";
import type { MiddlewareHandler } from "hono";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { defineModule, type ModuleDef } from "@platform/core/module";
import { INOVAFARMA_PERMISSIONS } from "./permissions.js";
import { createInovafarmaDriver } from "./driver.js";
import { registerColaboradoresRoutes, type UsersService } from "./colaboradores-routes.js";
import { declareColunasDesempenhoAudit } from "./colunas-desempenho-audit.js";
import { registerColunasDesempenhoRoutes } from "./colunas-desempenho-routes.js";
import { MemoryColunaDesempenhoStore } from "./colunas-desempenho-store.js";
import { PostgresColunaDesempenhoStore } from "./postgres-colunas-desempenho-store.js";
import { declarePedidosAudit } from "./pedidos-audit.js";
import { declareCotacaoAudit } from "./cotacao-audit.js";
import { registerCotacaoRoutes } from "./cotacao-routes.js";
import { MemoryCotacaoStore } from "./cotacao-store.js";
import { PostgresCotacaoStore } from "./postgres-cotacao-store.js";
import { registerPedidosRoutes } from "./pedidos-routes.js";
import { MemoryPedidoStore } from "./pedidos-store.js";
import { PostgresPedidoStore } from "./postgres-pedidos-store.js";
import { declarePedidosMinimosAudit } from "./pedidos-minimos-audit.js";
import { MemoryMinimoMaximoStore } from "./pedidos-minimos-store.js";
import { PostgresMinimoMaximoStore } from "./postgres-pedidos-minimos-store.js";
import { registerPedidosLancamentoRoutes } from "./pedidos-lancamento-routes.js";
import { declarePedidosListasAudit } from "./pedidos-listas-audit.js";
import { registerPedidosListasRoutes } from "./pedidos-listas-routes.js";
import { MemoryPedidosListasStore } from "./pedidos-listas-store.js";
import { PostgresPedidosListasStore } from "./postgres-pedidos-listas-store.js";
import { registerPedidosVisoesRoutes } from "./pedidos-visoes-routes.js";
import { MemoryPedidosVisoesStore } from "./pedidos-visoes-store.js";
import { PostgresPedidosVisoesStore } from "./postgres-pedidos-visoes-store.js";
import { registerDesempenhoRoutes } from "./desempenho-routes.js";
import type { ErpQuery } from "./metas-comum.js";
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
import { registerAcompanhamentoRoutes } from "./acompanhamento-routes.js";
import { MemoryApuracaoStore } from "./apuracao-store.js";
import { declareApuracaoAudit } from "./apuracao-audit.js";
import { PostgresApuracaoStore } from "./postgres-apuracao-store.js";
import { registerTiposMetaRoutes } from "./tipos-meta-routes.js";
import { MemoryTipoMetaStore } from "./tipos-meta-store.js";
import { MemoryMetaStore } from "./metas-store.js";
import { PostgresTipoMetaStore } from "./postgres-tipos-meta-store.js";
import { PostgresMetaStore } from "./postgres-meta-store.js";
import { registerPreVencidosRoutes, type PeriodsService } from "./pre-vencidos-routes.js";
import { declareItemPreVencidoAudit } from "./estoque-pre-vencidos-audit.js";
import { registerEstoquePreVencidosRoutes } from "./estoque-pre-vencidos-routes.js";
import { registerBaixasPreVencidosRoutes } from "./baixas-pre-vencidos-routes.js";
import { MemoryEstoquePreVencidoStore } from "./estoque-pre-vencidos-store.js";
import { MemoryBaixasCongeladasStore } from "./baixas-congeladas-store.js";
import { PostgresBaixasCongeladasStore } from "./postgres-baixas-congeladas-store.js";
import { registerCongelamentoBaixas, type BaixasDoPeriodoDeps } from "./baixas-do-periodo.js";
import { MemoryCorrecaoBaixaStore } from "./correcoes-baixa-store.js";
import { PostgresCorrecaoBaixaStore } from "./postgres-correcoes-baixa-store.js";
import { declareCorrecaoBaixaAudit } from "./correcoes-baixa-audit.js";
import { declareBaixasCongeladasAudit } from "./baixas-congeladas-audit.js";
import { PostgresEstoquePreVencidoStore } from "./postgres-estoque-pre-vencidos-store.js";
import { declareVinculoAudit, type AuditService } from "./vinculo-audit.js";
import { MemoryVinculoStore } from "./vinculo-store.js";

export { INOVAFARMA_PERMISSIONS, createInovafarmaDriver, PostgresVinculoStore, PostgresTipoMetaStore, PostgresFuroEstoqueStore };
export { NomeDuplicadoError } from "./erros-de-store.js";
export { UsuarioJaVinculadoError, VersaoDesatualizadaError } from "./vinculo-store.js";

/** Migrations do Plugin (schema Postgres "inovafarma"), na raiz do pacote: valem para `src` e para `dist`. */
export const INOVAFARMA_MIGRATIONS = { folder: resolve(import.meta.dirname, "../drizzle"), schema: "inovafarma" };

export interface InovafarmaPluginDeps {
  /** Middleware de autenticação injetado pelo servidor. */
  auth: MiddlewareHandler;
  /** Clientes de ERP ativos por ID; o InovaFarma utiliza a conexão com id `erpId`. */
  erpClients?: Record<string, ErpQuery | undefined>;
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
    register({ routes, permissions, services, events }) {
      const audit = services.use<AuditService>("audit", "log");
      declareVinculoAudit(audit);
      declareItemPreVencidoAudit(audit);
      declareCorrecaoBaixaAudit(audit);
      declareBaixasCongeladasAudit(audit);
      declareAvaliacaoAudit(audit);
      declareFuroEstoqueAudit(audit);
      declareTiposMetaAudit(audit);
      declareColunasDesempenhoAudit(audit);
      declarePedidosListasAudit(audit);
      declareMetasAudit(audit);
      declareApuracaoAudit(audit);
      declarePedidosAudit(audit);
      declareCotacaoAudit(audit);
      const store = db ? new PostgresVinculoStore(db) : new MemoryVinculoStore();
      const avaliacoes = db ? new PostgresAvaliacaoStore(db) : new MemoryAvaliacaoStore();
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
        vinculos: store,
        periods,
      });
      const estoquePreVencidos = db ? new PostgresEstoquePreVencidoStore(db) : new MemoryEstoquePreVencidoStore();
      const baixasCongeladas = db ? new PostgresBaixasCongeladasStore(db) : new MemoryBaixasCongeladasStore();
      const correcoesBaixa = db ? new PostgresCorrecaoBaixaStore(db) : new MemoryCorrecaoBaixaStore();
      const baixasDeps: BaixasDoPeriodoDeps = { erpClient: () => erpClients[erpId], store: estoquePreVencidos, congeladas: baixasCongeladas, correcoes: correcoesBaixa };
      registerCongelamentoBaixas({ events, periods, audit, users, ...baixasDeps });
      registerEstoquePreVencidosRoutes({ routes, permissions, auth, ...baixasDeps, vinculos: store, periods, audit });
      registerBaixasPreVencidosRoutes({ routes, permissions, auth, ...baixasDeps, vinculos: store, periods, audit });
      registerAvaliacoesRoutes({
        routes,
        permissions,
        auth,
        erpClient: () => erpClients[erpId],
        store: avaliacoes,
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
      const pedidosListas = db ? new PostgresPedidosListasStore(db) : new MemoryPedidosListasStore();
      registerPedidosListasRoutes({ routes, permissions, auth, store: pedidosListas, audit });
      registerPedidosVisoesRoutes({ routes, permissions, auth, store: db ? new PostgresPedidosVisoesStore(db) : new MemoryPedidosVisoesStore() });
      declarePedidosMinimosAudit(audit);
      registerPedidosLancamentoRoutes({ routes, permissions, auth, erpClient: () => erpClients[erpId], minimos: db ? new PostgresMinimoMaximoStore(db) : new MemoryMinimoMaximoStore(), audit, listas: pedidosListas });
      const pedidos = db ? new PostgresPedidoStore(db) : new MemoryPedidoStore();
      registerPedidosRoutes({ routes, permissions, auth, store: pedidos, audit });
      registerCotacaoRoutes({ routes, permissions, auth, erpClient: () => erpClients[erpId], pedidos, cotacoes: db ? new PostgresCotacaoStore(db) : new MemoryCotacaoStore(), audit });
      const tiposMeta = db ? new PostgresTipoMetaStore(db) : new MemoryTipoMetaStore();
      const metas = db ? new PostgresMetaStore(db) : new MemoryMetaStore();
      registerTiposMetaRoutes({ routes, permissions, auth, erpClient: () => erpClients[erpId], store: tiposMeta, metas, periods, audit });
      registerMetasRoutes({ routes, permissions, auth, erpClient: () => erpClients[erpId], tipos: tiposMeta, metas, vinculos: store, periods, audit });
      registerAcompanhamentoRoutes({
        routes,
        permissions,
        auth,
        events,
        erpClient: () => erpClients[erpId],
        tipos: tiposMeta,
        metas,
        vinculos: store,
        avaliacoes,
        estoque: estoquePreVencidos,
        congeladas: baixasCongeladas,
        correcoes: correcoesBaixa,
        apuracoes: db ? new PostgresApuracaoStore(db) : new MemoryApuracaoStore(),
        periods,
        audit,
        users,
      });
      const colunasDesempenho = db ? new PostgresColunaDesempenhoStore(db) : new MemoryColunaDesempenhoStore();
      registerColunasDesempenhoRoutes({ routes, permissions, auth, store: colunasDesempenho, audit });
      registerDesempenhoRoutes({ routes, permissions, auth, erpClient: () => erpClients[erpId], vinculos: store, periods, colunas: colunasDesempenho });
    },
  });
}
