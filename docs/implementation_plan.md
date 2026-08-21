# Plano de Implementação — Plataforma SDUI (Backend & Shared Foundation)

Este plano define a arquitetura, bibliotecas, estrutura de arquivos e etapas de implementação com TDD (Vitest) para a base da plataforma SDUI.

---

## 1. Visão Geral da Arquitetura e Decisões Alinhadas

- **Monorepo**: `pnpm` workspaces (`@platform/shared`, `@platform/server`, `@platform/web`).
- **Linguagem & Tipagem**: TypeScript estrito com **Generics profundos** em `defineRecipe`, inferindo `TRow` automaticamente para todas as colunas, `compute` e `actions`.
- **Backend**: **Hono** (API ultra-leve e type-safe) + **Drizzle ORM** (PostgreSQL) + **esbuild** (compilador de recipes em memória < 2ms) + **node:vm** (sandbox com timeout de 5s e rollback de persistência).
- **Data Layer**: Interfaces abstratas `SourceConnector`, `PersistenceStore` e `RecipeStore` com implementações Mocks para testes TDD com Vitest.
- **Frontend / Keyboard-First**: TanStack Table + Roving Tabindex Hook (Navegação com Setas, `Enter`/`F2` para edição inline, `Shift+Enter` para modal de Row Actions, `Esc` para cancelar).

---

## 2. Estrutura do Monorepo

```text
platform/
├── package.json                    (pnpm workspace root + vitest config)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── shared/                     (@platform/shared)
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── recipe.ts       (defineRecipe com inferência profunda de generics)
│   │   │   │   ├── fields.ts       (FieldType, DataType, ColumnDef)
│   │   │   │   ├── components.ts   (42 componentes declarativos e imperativos)
│   │   │   │   ├── rpc.ts          (Contratos de API: schema, data, action)
│   │   │   │   ├── iam.ts          (User, Role, Permission, Externals)
│   │   │   │   └── ui.ts           (APIs imperativas ui.confirm, ui.dialog, ui.toast)
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── server/                     (@platform/server)
│   │   ├── src/
│   │   │   ├── index.ts            (Hono App + rotas RPC)
│   │   │   ├── engine/
│   │   │   │   ├── compiler.ts     (esbuild transform + LRU cache)
│   │   │   │   ├── action-executor.ts (node:vm sandbox com 5s timeout e rollback)
│   │   │   │   ├── template-engine.ts (parser de tokens com bind params @p1)
│   │   │   │   └── recipe-store.ts (FileSystemRecipeStore)
│   │   │   ├── data/
│   │   │   │   ├── source-connector.ts (Interface + SqlServer + MockConnector)
│   │   │   │   ├── persistence-store.ts (Interface + Memory/Postgres Store)
│   │   │   │   ├── data-resolver.ts    (Merge source + persistence + compute)
│   │   │   │   └── permission-resolver.ts (Seleção de query por role)
│   │   │   └── routes/
│   │   │       ├── dashboards.ts   (GET /api/dashboards/:id/schema)
│   │   │       ├── data.ts         (GET /api/workspaces/:id/data/:cid)
│   │   │       └── actions.ts      (POST /api/workspaces/:id/actions/exec)
│   │   ├── tests/
│   │   │   ├── compiler.test.ts
│   │   │   ├── template-engine.test.ts
│   │   │   ├── data-resolver.test.ts
│   │   │   ├── action-executor.test.ts
│   │   │   └── recipe-integration.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                        (@platform/web — Fase 2)
│       ├── src/
│       │   ├── components/sdui/
│       │   │   ├── SDUIRenderer.tsx
│       │   │   ├── DataTable.tsx   (Keyboard-first com setas e Shift+Enter)
│       │   │   ├── StatCard.tsx
│       │   │   └── DynamicDialog.tsx
│       │   └── hooks/
│       │       ├── useKeyboardGrid.ts (Roving tabindex Excel-style)
│       │       └── useAction.ts
│       ├── package.json
│       └── vite.config.ts
│
└── recipes/
    └── fechamento-mes.recipe.ts
```

---

## 3. Bibliotecas Node.js Selecionadas

| Pacote | Função no Projeto |
| :--- | :--- |
| **`hono`** + **`@hono/node-server`** | Servidor API ultra-rápido com RPC type-sharing nativo |
| **`zod`** + **`@hono/zod-validator`** | Validação de schemas e contratos de API |
| **`esbuild`** | Compilação de TypeScript em memória (< 2ms) |
| **`drizzle-orm`** + **`postgres`** | ORM leve com geração de tipos e migrations |
| **`vitest`** | Framework de testes unitários e de integração nativo com TypeScript |
| **`pino`** | Logging estruturado de alta performance |

---

## 4. Etapas de Execução com TDD

### Fase 1: Setup do Monorepo & Pacote `@platform/shared`
- [ ] Inicializar `pnpm-workspace.yaml`, `package.json` raiz e `tsconfig.base.json`.
- [ ] Construir o pacote `@platform/shared` com os tipos genéricos de `defineRecipe`:
  - Inferência de colunas em `TRow` para `compute: (row: TRow) => number`.
  - Tipagem do contexto das actions: `{ row: TRow, form: any, persistence, ui, workspace }`.
  - Definições de todos os 42 componentes (declarativos e imperativos).

### Fase 2: Recipe Engine & Compilação em Memória (`@platform/server`)
- [ ] Criar o `RecipeCompiler` usando `esbuild.transform()` com cache em memória.
- [ ] Criar o `TemplateEngine`:
  - Testar parsing de tokens `{{workspace.start_date}}` e `{{user.externals.inovafarma}}`.
  - Garantir conversão para parâmetros bind seguros (`@p1`, `@p2`).
- [ ] Criar testes unitários no Vitest para o compilador e template engine.

### Fase 3: Data Resolver & Merge Engine
- [ ] Criar interfaces `SourceConnector` e `PersistenceStore` com implementações `MockConnector` e `MemoryPersistenceStore`.
- [ ] Criar o `DataResolver`:
  - Execução de queries no source externo.
  - Fusão (`LEFT JOIN`) com coleções e campos escalares de persistência.
  - Aplicação dos valores padrão (`defaultValue`).
  - Execução das funções `compute` (colunas calculadas e totais de KPIs).
- [ ] Testes unitários no Vitest validando o merge completo de dados.

### Fase 4: Action Executor & Sandbox
- [ ] Criar o `ActionExecutor` usando sandbox `node:vm`:
  - Injeção das APIs imperativas (`ui.confirm`, `ui.prompt`, `ui.dialog`, `ui.toast`, `ui.refresh`).
  - Coleta de `effects` para retorno ao cliente.
  - Implementação de timeout estrito de 5s e rollback em caso de falha.
- [ ] Testes unitários no Vitest para execução de actions, captura de erros e timeout.

### Fase 5: Integração com Hono API & Recipe Fechamento de Mês
- [ ] Criar rotas RPC do Hono conectando todas as peças.
- [ ] Teste de integração end-to-end com Vitest executando a recipe `fechamento-mes.recipe.ts`.

---

## 5. Plano de Verificação

### Testes Automatizados (Vitest):
```bash
# Executar todos os testes unitários e de integração
pnpm test
```
- Validação de inferência de tipos com `tsc --noEmit`.
- Teste de compilação de recipes em < 2ms.
- Teste de segurança contra SQL Injection via bind parameters.
- Teste de isolamento da sandbox (bloqueio de `process` e `fs`).
- Teste de cálculo dinâmico da coluna `total_a_receber` (`salario + comissao - penalidades`).
