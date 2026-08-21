# Celestia — Arquitetura Completa & Especificação Técnica

Plataforma de dashboards operacionais e fechamentos temporais orientada a **Server-Driven UI (SDUI)** e **Permission-First IAM**.  
O desenvolvedor/administrador escreve **Modelos (Recipes) em TypeScript** que definem fontes de dados do ERP, persistência da plataforma, layout e ações imperativas.  
O backend compila e executa as recipes em sandboxes seguras. O frontend React 19 + shadcn/ui atua como **renderer genérico e despachante de RPCs**.

---

## 1. Visão Geral da Arquitetura

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (SPA)                               │
│         Vite + React + shadcn/ui + TanStack Table/Query             │
│                                                                     │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ stat_card │  │ data_table│  │ bar_chart│  │ Dialogs / Forms   │  │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
│       │              │             │                  │             │
│       └──────────────┴─────────────┴──────────────────┘             │
│                          │                                          │
│              RPC: fetch schema, execute action                      │
│                          │                                          │
└──────────────────────────┼──────────────────────────────────────────┘
                           │ HTTP (JSON)
┌──────────────────────────┼──────────────────────────────────────────┐
│                      API LAYER (Hono)                               │
│                                                                     │
│  GET  /api/dashboards/:id/schema       → Retorna UI Schema          │
│  GET  /api/workspaces/:id/data/:cid    → Retorna dados do componente│
│  POST /api/workspaces/:id/actions      → Executa ação (RPC)         │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                      RECIPE ENGINE                                  │
│                                                                     │
│  ┌──────────────┐    ┌───────────────┐    ┌─────────────────────┐  │
│  │ RecipeStore   │    │ Compiler      │    │ Action Executor     │  │
│  │ (interface)   │    │ (esbuild)     │    │ (node:vm sandbox)   │  │
│  │               │    │               │    │                     │  │
│  │ ▸ FileSystem  │───▸│ .ts → .js     │───▸│ Executa ações com   │  │
│  │ ▸ Database    │    │ em memória    │    │ contexto injetado    │  │
│  └──────────────┘    └───────────────┘    └─────────────────────┘  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                      DATA RESOLVER                                  │
│                                                                     │
│  ┌──────────────┐    ┌───────────────┐    ┌─────────────────────┐  │
│  │SourceConnector│    │ Persistence   │    │ Merger              │  │
│  │ (interface)   │    │ Store         │    │                     │  │
│  │               │    │               │    │ LEFT JOIN entre     │  │
│  │ ▸ SqlServer   │───▸│ PostgreSQL    │───▸│ source + persistence│  │
│  │ ▸ PostgreSQL  │    │ (platform DB) │    │ + computed fields   │  │
│  │ ▸ MySQL       │    │               │    │ + default values    │  │
│  └──────────────┘    └───────────────┘    └─────────────────────┘  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                      IAM                                            │
│                                                                     │
│  Users → Role (1:1) → Permissions[]                                 │
│  User.externals: { "inovafarma": 42, "sap": 9001 }                 │
│  Permission Resolver: seleciona query por permissão do usuário      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Decisão de Stack

### Por que NÃO Next.js?
- Esta é uma **aplicação interna de negócios** (dashboards operacionais), **não um site público**.
- SEO é irrelevante — ninguém pesquisa no Google por um dashboard de fechamento.
- SSR/RSC adicionam complexidade desnecessária: overhead de hydration, server components, roteamento de servidor, caching de páginas.
- A aplicação é essencialmente uma **SPA autenticada** com chamadas de API.

### Stack Escolhida

| Camada | Tecnologia | Justificativa |
| :--- | :--- | :--- |
| **Frontend** | **Vite + React + shadcn/ui** | SPA pura, HMR instantâneo, zero overhead de SSR. shadcn dá componentes de alta qualidade (Table, Dialog, Form, Toast). |
| **Backend / API** | **Hono** (Node.js) | Ultra-leve (~14KB), TypeScript-first, middleware simples, sem opiniões forçadas. Perfeito para APIs de dados. |
| **Banco de Dados da Plataforma** | **PostgreSQL** | Armazena users, roles, workspaces, persistence, audit logs. Robusto, JSONB nativo. |
| **Fontes Externas dos Clientes** | **SQL Server, PostgreSQL, MySQL** | Cada "source" registrada na plataforma aponta para o banco do ERP do cliente. |
| **Compilação de Recipes** | **esbuild** | Transpila TypeScript → JavaScript em < 2ms, em memória, sem filesystem temporário. |
| **Execução de Actions** | **node:vm** (ou `isolated-vm`) | Sandbox segura para executar código das actions sem acesso ao filesystem do servidor. |
| **Monorepo** | **pnpm workspaces** | Pacotes `@platform/server`, `@platform/web`, `@platform/shared` (tipos compartilhados). |

### Estrutura do Monorepo

```text
platform/
├── package.json                  (pnpm workspace root)
├── pnpm-workspace.yaml
├── packages/
│   ├── shared/                   @platform/shared
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── workspace.ts      (Workspace, WorkspaceDateRange, WorkspaceStatus, WorkspaceSummary)
│   │   │   │   ├── components.ts     (DataTableColumnDef, DataTableProps, StatCardProps, ChartProps, UIComponentDef, LayoutDefinition)
│   │   │   │   ├── recipe.ts         (RecipeDef, defineRecipe, ActionDef, ActionContext, SourceDef, PersistenceDef)
│   │   │   │   ├── fields.ts         (FormFieldDef, FieldType, LookupConfig, TextFormFieldDef, MoneyFormFieldDef, etc.)
│   │   │   │   ├── iam.ts            (User, Role, JWTAccessPayload, JWTRefreshPayload, AuthTokens, PermissionCatalog)
│   │   │   │   ├── ui.ts             (ImperativeUIContext, UIEffect, OpenDialogOptions, ShowTableOptions, WizardOptions)
│   │   │   │   ├── rpc.ts            (ActionExecRequest/Response, ComponentDataRequest/Response, DashboardSchemaResponse)
│   │   │   │   └── index.ts          (Barrel export central de types)
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── server/                   @platform/server
│   │   ├── src/
│   │   │   ├── index.ts              (Hono app + rotas de Auth, IAM, Schemas e Workspaces)
│   │   │   ├── iam/
│   │   │   │   ├── password-service.ts       (Argon2id OWASP + Política de Senha Zod)
│   │   │   │   ├── token-service.ts          (JWT Access 5m + Refresh 7d HS256)
│   │   │   │   ├── system-permissions.ts     (Catálogo de permissões nativas system:*)
│   │   │   │   ├── permission-catalog.ts     (Scanner de recipes + Pruning de órfãs)
│   │   │   │   ├── permission-resolver.ts    (Resolução Permission-First por ordem)
│   │   │   │   ├── user-store.ts             (MemoryUserStore + CRUD de usuários e roles)
│   │   │   │   └── middleware.ts             (createAuthMiddleware + requirePermission guard)
│   │   │   ├── engine/
│   │   │   │   ├── compiler.ts               (esbuild TS → JS + sandbox node:vm)
│   │   │   │   ├── action-executor.ts        (Execução de actions imperativas com timeout 5s)
│   │   │   │   ├── template-engine.ts        (Interpolação segura anti-SQL Injection com bind params)
│   │   │   │   └── workspace-validator.ts    (Validação obrigatória de datas da Área de Trabalho)
│   │   │   └── data/
│   │   │       ├── source-connector.ts       (Interface + MockSourceConnector para ERPs)
│   │   │       ├── persistence-store.ts      (MemoryPersistenceStore + PostgreSQL platform DB)
│   │   │       └── data-resolver.ts          (Merge de dados ERP + persistência + RBAC)
│   │   └── package.json
│   │
│   └── web/                      @platform/web
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── api/
│       │   │   └── client.ts          (wrapper HTTP tipado para as rotas do Hono)
│       │   ├── components/
│       │   │   ├── ui/                (shadcn/ui components)
│       │   │   └── sdui/
│       │   │       ├── SDUIRenderer.tsx     (interpreta o schema e renderiza)
│       │   │       ├── StatCard.tsx
│       │   │       ├── DataTable.tsx
│       │   │       ├── BarChart.tsx
│       │   │       └── ActionButton.tsx     (dispara RPC pro backend)
│       │   ├── pages/
│       │   │   ├── LoginPage.tsx
│       │   │   ├── DashboardListPage.tsx
│       │   │   └── WorkspacePage.tsx        (a página principal)
│       │   └── hooks/
│       │       ├── useWorkspace.ts
│       │       └── useAction.ts
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
│
└── recipes/                      (Recipes em TypeScript — filesystem)
    ├── fechamento-mes.recipe.ts
    └── comissoes.recipe.ts
```

### Como rodar em DEV e PROD

```text
DEV:
  ┌────────────────────┐     proxy /api/*     ┌────────────────────┐
  │ Vite Dev Server    │ ──────────────────►  │ Hono (porta 3001)  │
  │ localhost:5173     │                      │                    │
  └────────────────────┘                      └────────────────────┘

PROD:
  ┌─────────────────────────────────────┐
  │ Hono (porta 3000)                   │
  │                                     │
  │  /api/*      → rotas de API         │
  │  /*          → serve static do      │
  │               Vite build (dist/)    │
  └─────────────────────────────────────┘
```

Em produção, o Hono serve os assets estáticos do build do Vite como fallback, resultando em **um único processo Node.js** que serve tudo.

---

## 3. Recipes em TypeScript (A "Receita" de cada Dashboard)

### 3.1. Por que TypeScript e não JSON?

| JSON Puro | TypeScript |
| :--- | :--- |
| Actions ficam em strings escapadas (`"action": "async ..."`) — ilegível | Actions são funções nativas com syntax highlighting e IntelliSense |
| Zero validação em tempo de escrita | Erros de tipo detectados antes de salvar |
| Sem autocomplete | `ui.` mostra `dialog`, `confirm`, `toast`, `refresh` automaticamente |
| Sem comentários | Pode comentar decisões de negócio inline |

### 3.2. Exemplo de Recipe (`fechamento-mes.recipe.ts`)

```typescript
import { defineRecipe } from "@platform/shared";

export default defineRecipe({
  id: "fechamento_mes",
  name: "Fechamento de Mês",
  description: "Conferência de vendas por vendedor e aplicação de penalidades.",

  workspace: {
    params: [
      { name: "start_date", label: "Data Inicial", type: "date", required: true },
      { name: "end_date", label: "Data Final", type: "date", required: true },
      {
        name: "categories_focus",
        label: "Categorias em Foco",
        type: "multi_select",
        required: false,
        lookup: {
          source: "inovafarma",
          query: "SELECT id AS value, name AS label FROM categories ORDER BY name",
        },
      },
    ],
  },

  sources: {
    inovafarma: {
      primaryKey: "vendedor_id",
      queries: {
        "fechamento_mes.all": {
          id: "q_vendas_all",
          query: `
            SELECT e.id AS vendedor_id, e.name AS vendedor, SUM(v.total) AS venda_geral
            FROM vendas v
            INNER JOIN employees e ON v.vendedor_id = e.id
            INNER JOIN products p ON v.product_id = p.id
            WHERE v.created_at BETWEEN {{workspace.start_date}} AND {{workspace.end_date}}
              AND ({{workspace.categories_focus}} IS NULL
                   OR p.category_id IN ({{workspace.categories_focus}}))
            GROUP BY e.id, e.name
          `,
          columns: [
            { name: "vendedor_id", type: "int", label: "ID Vendedor" },
            { name: "vendedor", type: "string", label: "Vendedor" },
            { name: "venda_geral", type: "money", label: "Venda Geral" },
          ],
        },
        "fechamento_mes.self": {
          id: "q_vendas_self",
          query: `
            SELECT e.id AS vendedor_id, e.name AS vendedor, SUM(v.total) AS venda_geral
            FROM vendas v
            INNER JOIN employees e ON v.vendedor_id = e.id
            INNER JOIN products p ON v.product_id = p.id
            WHERE v.created_at BETWEEN {{workspace.start_date}} AND {{workspace.end_date}}
              AND e.id = {{user.externals.inovafarma}}
              AND ({{workspace.categories_focus}} IS NULL
                   OR p.category_id IN ({{workspace.categories_focus}}))
            GROUP BY e.id, e.name
          `,
          columns: [
            { name: "vendedor_id", type: "int", label: "ID Vendedor" },
            { name: "vendedor", type: "string", label: "Vendedor" },
            { name: "venda_geral", type: "money", label: "Venda Geral" },
          ],
        },
      },
    },
  },

  persistence: [
    {
      id: "penalidades_vendedor",
      targetSource: "inovafarma",
      targetForeignKey: "vendedor_id",
      mode: "collection",
      itemSchema: {
        value:  { type: "money",    label: "Valor (R$)",  defaultValue: 0 },
        reason: { type: "string",   label: "Motivo",      defaultValue: "" },
      },
      computedFields: {
        total_penalidades: {
          type: "money",
          aggregate: { function: "sum", field: "value" },
        },
      },
    },
  ],

  // ────────────────────────────────────────────────────
  // ACTIONS: Funções TypeScript nativas com IntelliSense!
  // ────────────────────────────────────────────────────

  actions: [
    {
      id: "adicionar_penalidade",
      label: "Adicionar Penalidade",
      icon: "AlertTriangle",
      permission: "fechamento_mes.penalty",

      action: async ({ row, ui, persistence }) => {
        const form = await ui.dialog.open({
          title: "Adicionar Penalidade",
          description: "Informe o valor da penalidade para o vendedor.",
          fields: [
            { name: "vendedor", label: "Vendedor", type: "text", readOnly: true, defaultValue: row.vendedor },
            { name: "valor", label: "Valor (R$)", type: "money", required: true, defaultValue: 5 },
            { name: "reason", label: "Motivo", type: "textarea", required: true },
          ],
        });
        if (!form) return;

        await persistence.push("penalidades_vendedor", {
          value: form.valor,
          reason: form.reason,
        });
        ui.toast.success("Penalidade inserida com sucesso!");
        ui.refresh();
      },
    },

    {
      id: "visualizar_penalidades",
      label: "Ver Penalidades",
      icon: "Eye",
      permission: "fechamento_mes.all",

      action: async ({ row, ui }) => {
        await ui.dialog.showTable({
          title: `Penalidades de ${row.vendedor}`,
          size: "lg",
          source: "penalidades_vendedor",
          columns: [
            { key: "value",      label: "Valor (R$)", format: "currency" },
            { key: "reason",     label: "Motivo" },
            { key: "created_at", label: "Data/Hora",  format: "datetime" },
          ],
          rowActions: ["remover_penalidade"],
        });
      },
    },

    {
      id: "remover_penalidade",
      label: "Remover",
      icon: "Trash2",
      variant: "destructive",
      permission: "fechamento_mes.penalty",

      action: async ({ row, ui, persistence }) => {
        const ok = await ui.confirm(
          "Remover Penalidade?",
          `Tem certeza que deseja remover a penalidade de R$ ${row.value}?`
        );
        if (!ok) return;

        await persistence.delete("penalidades_vendedor", row.id);
        ui.toast.success("Penalidade removida!");
        ui.refresh();
      },
    },
  ],

  // ────────────────────────────────────────────────────
  // UI LAYOUT: Declaração pura dos componentes visuais
  // ────────────────────────────────────────────────────

  ui: {
    layout: { type: "grid", columns: 12, gap: 16 },
    components: [
      {
        id: "kpi_total_vendas",
        component: "stat_card",
        layoutProps: { colSpan: 6 },
        props: {
          title: "Total em Vendas",
          source: "inovafarma",
          aggregate: { function: "sum", field: "venda_geral" },
          format: "currency",
          icon: "DollarSign",
        },
      },
      {
        id: "kpi_total_penalidades",
        component: "stat_card",
        layoutProps: { colSpan: 6 },
        props: {
          title: "Total em Penalidades",
          source: "penalidades_vendedor",
          aggregate: { function: "sum", field: "total_penalidades" },
          format: "currency",
          icon: "AlertCircle",
        },
      },
      {
        id: "tabela_vendedores",
        component: "data_table",
        layoutProps: { colSpan: 12 },
        props: {
          title: "Desempenho por Vendedor",
          source: "inovafarma",
          columns: [
            { key: "vendedor_id", label: "ID", sortable: true },
            { key: "vendedor", label: "Vendedor", sortable: true, searchable: true },
            { key: "venda_geral", label: "Venda Geral", format: "currency", sortable: true },
            { key: "penalidades_vendedor.total_penalidades", label: "Total Penalidades", format: "currency", sortable: true },
          ],
          rowActions: ["visualizar_penalidades", "adicionar_penalidade"],
          pagination: { pageSize: 10 },
        },
      },
    ],
  },
});
```

### 3.3. `defineRecipe` — Contrato TypeScript para o SDK

A função `defineRecipe` é apenas um *identity function* tipada que garante autocompletion e validação:

```typescript
// packages/shared/src/types/recipe.ts

export interface DashboardRecipe {
  id: string;
  name: string;
  description: string;

  workspace: {
    params: WorkspaceParam[];
  };

  sources: Record<string, SourceDefinition>;
  persistence: PersistenceCollection[];
  actions: ActionDefinition[];

  ui: {
    layout: LayoutDefinition;
    components: ComponentDefinition[];
  };
}

export function defineRecipe(recipe: DashboardRecipe): DashboardRecipe {
  return recipe;
}
```

---

## 4. Interfaces Abstratas (Preparadas para Múltiplas Implementações)

### 4.1. `RecipeStore` — De onde vêm as Recipes

```typescript
// packages/server/src/engine/recipe-store.ts

export interface RecipeStore {
  /** Lista todas as recipes disponíveis (id + nome) */
  list(): Promise<RecipeSummary[]>;

  /** Carrega o código-fonte TypeScript de uma recipe */
  load(recipeId: string): Promise<string>;

  /** Salva/atualiza uma recipe (para o futuro editor web) */
  save(recipeId: string, tsCode: string): Promise<void>;
}

// ── Implementação: Filesystem (v1 — Fase Atual) ──────────────

export class FileSystemRecipeStore implements RecipeStore {
  constructor(private recipesDir: string) {}

  async list() {
    // Lê todos os *.recipe.ts do diretório
  }

  async load(recipeId: string) {
    // Lê o arquivo recipes/{recipeId}.recipe.ts
  }

  async save(recipeId: string, tsCode: string) {
    // Escreve no filesystem
  }
}

// ── Implementação: Database (v2 — Futuro) ─────────────────────

export class DatabaseRecipeStore implements RecipeStore {
  constructor(private db: Database) {}

  async list() {
    // SELECT id, name FROM recipes
  }

  async load(recipeId: string) {
    // SELECT ts_code FROM recipes WHERE id = ?
  }

  async save(recipeId: string, tsCode: string) {
    // UPSERT INTO recipes (id, ts_code, compiled_js, updated_at) VALUES (...)
  }
}
```

### 4.2. `SourceConnector` — Conexão com Bancos Externos dos Clientes

```typescript
// packages/server/src/data/source-connector.ts

export interface SourceConnector {
  /** Executa uma query SQL parametrizada no banco externo */
  execute(query: string, params: Record<string, unknown>): Promise<Row[]>;

  /** Testa a conectividade com o banco */
  healthCheck(): Promise<boolean>;

  /** Libera conexões do pool */
  disconnect(): Promise<void>;
}

// ── Implementação: SQL Server ────────────────────────────────

export class SqlServerConnector implements SourceConnector {
  // Usa `mssql` ou `tedious`
}

// ── Implementação: PostgreSQL ────────────────────────────────

export class PostgresConnector implements SourceConnector {
  // Usa `pg` ou `postgres.js`
}

// ── Implementação: MySQL ─────────────────────────────────────

export class MySqlConnector implements SourceConnector {
  // Usa `mysql2`
}
```

### 4.3. Source Registry — Registro Central de Fontes

```typescript
// packages/server/src/data/source-registry.ts

// Armazenado no banco da plataforma (tabela `sources`):
// | name          | type       | connection_string                    |
// |---------------|------------|--------------------------------------|
// | inovafarma    | sqlserver  | Server=10.0.0.5;Database=InovaFarma  |
// | analytics_pg  | postgres   | postgres://user:pass@host/db          |

export class SourceRegistry {
  /** Dado o nome, retorna o SourceConnector correto já instanciado */
  getConnector(sourceName: string): SourceConnector {
    const config = this.loadFromDB(sourceName);
    switch (config.type) {
      case "sqlserver":  return new SqlServerConnector(config.connectionString);
      case "postgres":   return new PostgresConnector(config.connectionString);
      case "mysql":      return new MySqlConnector(config.connectionString);
    }
  }
}
```

---

## 5. Fluxo de Execução: Do Clique ao Dado

### 5.1. Carregar um Dashboard/Workspace

```text
1. Frontend: GET /api/dashboards/fechamento_mes/schema
   │
2. Backend:
   ├── RecipeStore.load("fechamento_mes")  →  código TypeScript
   ├── Compiler.compile(tsCode)            →  módulo JavaScript
   ├── Extrai: workspace.params, sources (sem SQL!), persistence schemas,
   │           actions (só id + label + icon + permission), ui layout
   └── Retorna o "UI Schema" (JSON seguro, sem código, sem SQLs)
   │
3. Frontend: Renderiza a tela com base no UI Schema
```

**Importante**: O UI Schema que o frontend recebe **nunca contém** código das actions nem queries SQL. Ele só tem metadados declarativos suficientes para renderizar a interface.

O **UI Schema** enviado ao frontend se parece com:

```json
{
  "id": "fechamento_mes",
  "name": "Fechamento de Mês",
  "workspace": {
    "params": [
      { "name": "start_date", "label": "Data Inicial", "type": "date", "required": true },
      { "name": "end_date", "label": "Data Final", "type": "date", "required": true }
    ]
  },
  "actions": [
    { "id": "adicionar_penalidade", "label": "Adicionar Penalidade", "icon": "AlertTriangle" },
    { "id": "remover_penalidade", "label": "Remover", "icon": "Trash2", "variant": "destructive" }
  ],
  "ui": {
    "layout": { "type": "grid", "columns": 12, "gap": 16 },
    "components": [ "..." ]
  }
}
```

### 5.2. Carregar Dados de um Componente

```text
1. Frontend: GET /api/workspaces/ws_101/data/tabela_vendedores?page=1&page_size=10&sort_by=venda_geral&order=desc
   │
2. Backend:
   ├── Carrega a recipe compilada
   ├── PermissionResolver: usuário tem "fechamento_mes.all"?
   │   └── Seleciona a query correspondente
   ├── TemplateEngine: interpola {{workspace.start_date}} etc.
   ├── SourceConnector: executa SQL no banco do cliente (SQL Server)
   ├── PersistenceStore: busca registros de persistence para os IDs retornados
   ├── DataResolver: faz merge (LEFT JOIN lógico) + computed fields + defaults
   └── Retorna JSON com dados + meta de paginação
   │
3. Frontend: Renderiza a tabela com os dados
```

### 5.3. Executar uma Ação (RPC)

```text
1. Usuário clica em "Adicionar Penalidade" na linha do João
   │
2. Frontend: Exibe o dialog (definido no UI Schema da action)
   Usuário preenche: valor = 50, reason = "Atraso"
   │
3. Frontend: POST /api/workspaces/ws_101/actions
   {
     "action_id": "adicionar_penalidade",
     "row": { "vendedor_id": 42, "vendedor": "João", "venda_geral": 5000 },
     "form_data": { "valor": 50, "reason": "Atraso" },
     "workspace_version": 12
   }
   │
4. Backend:
   ├── Valida permissão ("fechamento_mes.penalty")
   ├── Valida versão (optimistic locking — se v != 12, rejeita com 409)
   ├── Carrega a recipe e encontra a action "adicionar_penalidade"
   ├── Executa a função TypeScript dentro da sandbox (node:vm)
   │   com contexto injetado:
   │   ├── row:         dados da linha (read-only)
   │   ├── persistence: { push, delete, set } — operações no banco da plataforma
   │   ├── ui:          { dialog, confirm, toast, refresh } — retornam instruções pro frontend
   │   └── workspace:   { id, start_date, end_date }
   │
   │   A sandbox NÃO tem acesso a: filesystem, rede, process, require
   │
   └── Retorna resposta estruturada
   │
5. Backend responde:
   {
     "success": true,
     "effects": [
       { "type": "toast", "variant": "success", "message": "Penalidade inserida!" },
       { "type": "refresh_data" }
     ],
     "workspace_version": 13
   }
   │
6. Frontend: Executa os efeitos (toast + refetch dos dados)
```

### 5.4. Sobre a Execução das Actions no Servidor

A parte crucial: as functions `action` escritas pelo desenvolvedor na recipe **são executadas no servidor, não no browser**. No entanto, os métodos de `ui` (como `ui.dialog.open`, `ui.confirm`) **não abrem modais no servidor** — eles produzem **instruções declarativas** que o servidor coleta e retorna ao frontend como `effects`.

Porém, no fluxo descrito acima, o dialog de formulário é definido **antes** do envio da action (seção 5.3, passo 2). Ou seja:

```text
Fluxo de Actions com Dialog (2 fases):

  FASE 1 — Frontend abre o dialog localmente
    O frontend lê a definição do dialog no UI Schema da action
    e renderiza o formulário. Nenhuma chamada ao backend ainda.

  FASE 2 — Frontend envia a RPC com os dados do formulário
    POST /api/workspaces/:id/actions
    O backend executa a lógica de persistência.
    Retorna os effects (toast, refresh).
```

Para actions sem dialog (como "Remover"), o fluxo inteiro acontece em uma única chamada:
```text
  Frontend: POST /api/workspaces/:id/actions { action_id: "remover_penalidade", row, workspace_version }
  Backend:  Executa a action, que internamente chama persistence.delete(...)
  Backend:  Retorna { effects: [toast, refresh], workspace_version: 14 }
```

---

## 6. Recipe Engine — Compilação e Execução em Runtime

### 6.1. Compiler (esbuild)

```typescript
// packages/server/src/engine/compiler.ts

import * as esbuild from "esbuild";

export class RecipeCompiler {
  /** Cache em memória: recipeId → módulo compilado */
  private cache = new Map<string, CompiledRecipe>();

  async compile(recipeId: string, tsCode: string): Promise<CompiledRecipe> {
    // Checa cache
    const cached = this.cache.get(recipeId);
    if (cached) return cached;

    // Transpila TS → JS em memória (< 2ms)
    const result = await esbuild.transform(tsCode, {
      loader: "ts",
      target: "node20",
      format: "cjs",
    });

    // Executa o módulo para extrair o objeto da recipe
    const recipe = this.evaluate(result.code);
    this.cache.set(recipeId, recipe);
    return recipe;
  }

  /** Invalida o cache (chamado quando a recipe é editada) */
  invalidate(recipeId: string) {
    this.cache.delete(recipeId);
  }
}
```

### 6.2. Action Executor (node:vm Sandbox)

```typescript
// packages/server/src/engine/action-executor.ts

import { createContext, Script } from "node:vm";

export class ActionExecutor {
  async execute(actionFn: Function, context: ActionContext): Promise<ActionResult> {
    const effects: UIEffect[] = [];

    // Monta o contexto com as APIs permitidas
    const sandboxContext = {
      row: Object.freeze(context.row),  // read-only
      workspace: Object.freeze(context.workspace),

      persistence: {
        push:   async (target: string, item: any) => { /* grava no PostgreSQL da plataforma */ },
        delete: async (target: string, itemId: string) => { /* ... */ },
        set:    async (target: string, itemId: string, data: any) => { /* ... */ },
      },

      ui: {
        toast: {
          success: (msg: string) => effects.push({ type: "toast", variant: "success", message: msg }),
          error:   (msg: string) => effects.push({ type: "toast", variant: "error", message: msg }),
        },
        refresh: () => effects.push({ type: "refresh_data" }),

        confirm: async (title: string, description: string) => {
          // Para actions que precisam de confirmação no servidor:
          // Retorna true/false com base em form_data.confirmed enviado pelo frontend
          return context.formData?.__confirmed === true;
        },
      },
    };

    // Executa a action na sandbox
    await actionFn(sandboxContext);

    return {
      success: true,
      effects,
      workspaceVersion: context.newVersion,
    };
  }
}
```

---

## 7. IAM — Autenticação, Usuários e Permissões

### 7.1. Modelo de Dados

```text
┌──────────────┐     1:1      ┌──────────────┐     1:N      ┌──────────────┐
│    users     │─────────────▸│    roles     │─────────────▸│ permissions  │
├──────────────┤              ├──────────────┤              ├──────────────┤
│ id           │              │ id           │              │ role_id      │
│ fullname     │              │ name         │              │ permission   │
│ username     │              │ description  │              └──────────────┘
│ email        │              └──────────────┘
│ password_hash│
│ role_id      │
│ externals    │  ← JSONB: { "inovafarma": 42, "sap": 9001 }
│ status       │
│ created_at   │
└──────────────┘
```

### 7.2. Permission Resolver

Dado um usuário com role `"role_vendedor"` (que tem permissão `"fechamento_mes.self"`), ao acessar a source `inovafarma`, o resolver:

1. Lê as queries da source: `{ "fechamento_mes.all": {...}, "fechamento_mes.self": {...} }`.
2. Verifica quais chaves correspondem às permissões do usuário.
3. Seleciona a query de maior prioridade que o usuário possui.
4. Interpola os tokens (ex: `{{user.externals.inovafarma}}` → `42`).

---

## 8. Padrões de Execução e Edge Cases

### 8.1. Paginação e Ordenação Server-Side (Tabelas)

Quando o frontend solicita dados de uma `data_table` com paginação ativada:

```text
GET /api/workspaces/ws_101/data/tabela_vendedores?page=2&page_size=10&sort_by=venda_geral&order=desc
```

O backend injeta `ORDER BY venda_geral DESC OFFSET 10 FETCH NEXT 10 ROWS ONLY` na query SQL e retorna:

```json
{
  "data": [ { "vendedor_id": 1, "vendedor": "João", "venda_geral": 5000.00 }, "..." ],
  "meta": { "page": 2, "page_size": 10, "total_records": 150, "total_pages": 15 }
}
```

### 8.2. Gráficos e KPIs — Consultas Globais (Sem Paginação)

Componentes como `stat_card`, `bar_chart` e `pie_chart` **nunca usam paginação**. Executam queries de agregação global (`SUM()`, `COUNT()`, `TOP N`) sobre o dataset inteiro do período do workspace.

### 8.3. Controle de Concorrência (Optimistic Locking)

Toda mutação (`persistence.push`, `persistence.set`, `persistence.delete`) envia `workspace_version`. Se outro operador alterou o workspace, o backend rejeita com `409 Conflict` e o frontend exibe um alerta solicitando reload.

### 8.4. Valores Padrão na Persistence (`defaultValue`)

Todo campo de `itemSchema` na persistence **deve** especificar `defaultValue`. Quando o Data Resolver faz o merge e não encontra registros de persistence para uma linha do ERP, ele injeta os defaults automaticamente, garantindo `0.00` para `money`, `""` para `string`, etc.

---

## 9. Banco de Dados da Plataforma (PostgreSQL)

### Tabelas Principais

```sql
-- Fontes de dados externas dos clientes
CREATE TABLE sources (
  name            TEXT PRIMARY KEY,       -- "inovafarma"
  type            TEXT NOT NULL,          -- "sqlserver" | "postgres" | "mysql"
  connection_str  TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Usuários
CREATE TABLE users (
  id              TEXT PRIMARY KEY,       -- "usr_1001"
  fullname        TEXT NOT NULL,
  username        TEXT UNIQUE NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role_id         TEXT REFERENCES roles(id),
  externals       JSONB DEFAULT '{}',     -- { "inovafarma": 42 }
  status          TEXT DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Roles
CREATE TABLE roles (
  id              TEXT PRIMARY KEY,       -- "role_operador"
  name            TEXT NOT NULL,
  description     TEXT
);

-- Permissões por Role
CREATE TABLE role_permissions (
  role_id         TEXT REFERENCES roles(id),
  permission      TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

-- Workspaces (instâncias de dashboards)
CREATE TABLE workspaces (
  id              TEXT PRIMARY KEY,       -- "ws_101"
  recipe_id       TEXT NOT NULL,          -- "fechamento_mes"
  params          JSONB NOT NULL,         -- { "start_date": "2026-01-01", ... }
  version         INT DEFAULT 1,
  status          TEXT DEFAULT 'open',    -- "open" | "closed"
  created_by      TEXT REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Dados de Persistence (genérico para qualquer coleção)
CREATE TABLE persistence_items (
  id              TEXT PRIMARY KEY,       -- UUID
  workspace_id    TEXT REFERENCES workspaces(id),
  collection_id   TEXT NOT NULL,          -- "penalidades_vendedor"
  foreign_key     TEXT NOT NULL,          -- "42" (vendedor_id)
  data            JSONB NOT NULL,         -- { "value": 50, "reason": "Atraso" }
  created_by      TEXT REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Log (preenchido automaticamente por event bus)
CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  workspace_id    TEXT REFERENCES workspaces(id),
  user_id         TEXT REFERENCES users(id),
  action          TEXT NOT NULL,          -- "persistence.push"
  collection_id   TEXT,
  item_id         TEXT,
  payload         JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 10. Próximos Passos de Implementação

### Fase 1 — Fundação (MVP)
1. **Monorepo Setup**: `pnpm workspaces` com `@platform/shared`, `@platform/server`, `@platform/web`.
2. **Shared Types**: `defineRecipe`, tipos de Recipe, tipos de RPC (request/response).
3. **Hono API**: Rotas básicas (`GET /schema`, `GET /data`, `POST /actions`).
4. **Recipe Engine**: `FileSystemRecipeStore` + `RecipeCompiler` (esbuild) + cache em memória.
5. **IAM**: Login com JWT, middleware de autenticação, permission resolver.
6. **Frontend SPA**: Vite + React + shadcn. `SDUIRenderer`, `DataTable`, `StatCard`, `ActionButton`.

### Fase 2 — Data Layer
7. **Source Registry + SQL Server Connector**: Conectar ao banco do cliente e executar queries.
8. **Persistence Store**: CRUD na tabela `persistence_items` do PostgreSQL.
9. **Data Resolver**: Merge source + persistence + computed fields + defaults.
10. **Template Engine**: Parser de `{{workspace.start_date}}`, `{{user.externals.inovafarma}}`.

### Fase 3 — Produção
11. **Action Executor**: Sandbox `node:vm` para execução segura das actions.
12. **Optimistic Locking**: Validação de `workspace_version` em toda mutação.
13. **Audit Log**: Event bus que grava automaticamente toda operação.
14. **DatabaseRecipeStore**: Migrar recipes do filesystem para o banco com editor Monaco no frontend.

---

## 11. Arquitetura de Segurança, IAM & Permission-First

A plataforma opera sob um modelo rigoroso de **Segurança Permission-First**, onde toda e qualquer operação (consultas ao banco externo, botões operacionais, navegação em telas e rotinas administrativas) exige uma string de permissão explícita validada no backend.

### 11.1. Nomenclatura na Interface (PT-BR)
Para tornar o sistema amigável a usuários de negócio e operadores contábeis/financeiros, adotamos a convenção:
- **Recipe** ➔ **Modelo** *(o molde/dashboard cadastrado)*
- **Workspace** ➔ **Área de Trabalho** *(a sessão/fechamento ativo de um período)*

### 11.2. Autenticação, Senhas e Sessão
- **Hashing Criptográfico Padrão Ouro**: Utiliza exclusivamente **Argon2id** (`@node-rs/argon2`) parametrizado conforme recomendações da **OWASP** (`memoryCost: 19456` = 19 MiB, `timeCost: 2`, `parallelism: 1`), gerando hashes no formato PHC `$argon2id$v=19$...`.
- **Política de Senhas**: Mínimo de 8 caracteres exigindo obrigatoriamente letras maiúsculas, minúsculas, números e caracteres especiais (`[!@#$%^&*...]`).
- **Sem "Esqueci Minha Senha"**: Redefinição de credenciais realizada exclusivamente por administradores autorizados com a permissão `system:users:reset_password`.
- **Tokens de Acesso**:
  - **Access Token (5 minutos)**: JWT stateless assinado com `HS256`, contendo os claims `sub`, `username`, `fullname`, `role`, `permissions` e `externals` (mapeamento de IDs nos ERPs).
  - **Refresh Token (7 dias)**: JWT com `type: "refresh"`, gravado em Cookie seguro `HttpOnly, Secure, SameSite=Strict`.

### 11.3. Padrão de Permissões e Catálogo Unificado
Todas as permissões seguem formatos padronizados separados por dois-pontos:
- **Funções Nativas do Sistema**: `system:<modulo>:<acao>` (ex: `system:users:create`, `system:workspaces:create`, `system:roles:update`, `system:audit:read`).
- **Dashboards / Modelos**:
  - **Visualização**: `recipe:<recipe_id>:view` (ex: `recipe:fechamento_mes:view`)
  - **Consultas (Queries)**: `recipe:<recipe_id>:query:<nome>` (ex: `recipe:fechamento_mes:query:all`, `recipe:fechamento_mes:query:self`)
  - **Ações Operacionais (Actions)**: `recipe:<recipe_id>:action:<id>` (ex: `recipe:fechamento_mes:action:adicionar_penalidade`)

### 11.4. Descoberta Dinâmica e Higienização de Órfãs (`Pruning`)
O backend escaneia as Recipes registradas e compõe a árvore unificada de permissões. Caso uma action ou query seja removida ou renomeada em uma Recipe, o motor `PermissionCatalogEngine.pruneOrphanPermissions` remove automaticamente essas permissões órfãs de todos os grupos de acesso, impedindo permissões fantasmas.

### 11.5. Resolução Permission-First de Queries
Ao consultar uma fonte de dados no ERP, o `PermissionResolver` avalia as queries declaradas na Recipe **na ordem em que foram escritas**. A primeira query compatível com as permissões do usuário logado é executada (garantindo que gerentes vejam a query geral e vendedores vejam apenas a query filtrada por seu ID). Se nenhuma coincidir, a requisição é bloqueada com `403 Forbidden`.

### 11.6. Validação Obrigatória de Datas da Área de Trabalho
Toda Área de Trabalho exige obrigatoriamente `start_date` e `end_date` válidos. O validador `WorkspaceValidator` rejeita requisições onde a **Data Final seja anterior à Data Inicial** (`end_date < start_date`), respondendo com `400 Bad Request`.

