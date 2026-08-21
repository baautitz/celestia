# AGENTS.md — Technical Architecture & Operational Directives for AI Agents

> **Audience**: Autonomous Coding Agents, Antigravity, Claude Code, Cursor, Copilot, Cline, Windsurf.  
> **Platform**: Celestia — Server-Driven UI (SDUI) & Permission-First IAM Enterprise Platform.  
> **Runtime**: Node.js >= 20.x, TypeScript >= 5.6 (strict mode), pnpm workspaces.

---

## 1. System Identity & Mission

**Celestia** is an enterprise **Server-Driven UI (SDUI)** engine with an embedded **Permission-First IAM** system designed for high-stakes enterprise operations (monthly closings, retail auditing, sales commissions, pharmacy/ERP reconciliations).

- **Backend**: [Hono](https://hono.dev/) on Node.js (ultra-fast, typed RPC, minimal overhead).
- **Security & Caching**: **Argon2id** (`@node-rs/argon2`), stateless JWT (5 min) + Refresh Token (7 days).
- **SDUI Engine**: TypeScript-defined Recipes compiled in-memory via `esbuild` and executed inside isolated `node:vm` sandboxes.
- **Frontend**: Vite + React 19 + shadcn/ui + Tailwind CSS v4.
- **PT-BR UI Terminology**:
  - `Recipe` ➔ **Modelo** (the reusable blueprint/dashboard definition).
  - `Workspace` ➔ **Área de Trabalho** (the active session/closing period).

---

## 2. Monorepo Map

```text
celestia/
├── packages/
│   ├── shared/                   (@platform/shared) -> Source of truth for contracts & types
│   │   └── src/
│   │       ├── types/
│   │       │   ├── workspace.ts  -> Workspace, WorkspaceDateRange, WorkspaceStatus, WorkspaceSummary
│   │       │   ├── components.ts -> DataTableColumnDef, DataTableProps, StatCardProps, ChartProps, UIComponentDef, LayoutDefinition
│   │       │   ├── recipe.ts     -> RecipeDef, defineRecipe, ActionDef, ActionContext, SourceDef, PersistenceDef
│   │       │   ├── fields.ts     -> FormFieldDef, FieldType, LookupConfig, BaseFormFieldDef, etc.
│   │       │   ├── iam.ts        -> User, Role, JWTAccessPayload, JWTRefreshPayload, AuthTokens, PermissionCatalog
│   │       │   ├── ui.ts         -> ImperativeUIContext, UIEffect, OpenDialogOptions, ShowTableOptions, WizardOptions
│   │       │   ├── rpc.ts        -> ActionExecRequest/Response, ComponentDataRequest/Response, DashboardSchemaResponse
│   │       │   └── index.ts      -> Central barrel export
│   │       └── index.ts
│   │
│   ├── server/                   (@platform/server) -> Backend API, Compiler, IAM & Data Resolver
│   │   └── src/
│   │       ├── index.ts          -> Hono app entrypoint, public & protected routes
│   │       ├── iam/
│   │       │   ├── password-service.ts    -> Argon2id OWASP hashing & Zod password complexity validator
│   │       │   ├── token-service.ts       -> JWT Access (5 min) & Refresh (7 days) HS256 tokens
│   │       │   ├── system-permissions.ts  -> Static system:* permissions catalog
│   │       │   ├── permission-catalog.ts  -> Recipe scanner & automatic orphan permission pruner
│   │       │   ├── permission-resolver.ts -> Permission-first query & action resolver (declaration order)
│   │       │   ├── user-store.ts          -> MemoryUserStore with sanitization & initial seeds
│   │       │   └── middleware.ts          -> createAuthMiddleware & requirePermission guards
│   │       ├── engine/
│   │       │   ├── compiler.ts            -> esbuild in-memory transpiler + node:vm isolated sandbox
│   │       │   ├── action-executor.ts     -> Action executor with 5s timeout & imperative UI context
│   │       │   ├── template-engine.ts     -> Safe query parameterizer (converts {{...}} into @p1, @p2)
│   │       │   └── workspace-validator.ts -> Mandatory workspace dates validator (end_date >= start_date)
│   │       └── data/
│   │           ├── source-connector.ts    -> SourceConnector interface & MockSourceConnector
│   │           ├── persistence-store.ts   -> MemoryPersistenceStore & Postgres persistence adapter
│   │           └── data-resolver.ts       -> Merges ERP sources + platform persistence + compute columns
│   │
│   └── web/                      (@platform/web) -> Frontend SPA (Vite + React 19 + shadcn/ui)
│       └── src/
│           ├── components/
│           │   ├── sdui/         -> SDUITable, SDUICard, SDUIChart, SDUIStatCard
│           │   ├── forms/        -> DynamicFormFields, WizardDialog
│           │   ├── layout/       -> AppLayout, Header, Navigation
│           │   ├── recipes/      -> RecipePermissionsSheet
│           │   └── ui/           -> 100% Pure shadcn/ui primitives (InputGroup, MoneyInput, MobileCard, etc.)
│           ├── pages/            -> WorkspacesPage, WorkspaceDetailPage, RecipeDashboardPage, IAMUsersPage, IAMRolesPage, LoginPage
│           ├── context/          -> AuthContext, ImperativeUIContext, HeaderActionsContext
│           ├── hooks/            -> use-mobile, use-theme
│           └── lib/              -> api-client, utils, dynamic-form
│
└── recipes/                      (Production Recipes in TypeScript)
    └── fechamento-mes.recipe.ts  -> Reference monthly closing recipe
```

---

## 3. Hard Architectural Invariants (Non-Negotiable)

When generating or modifying code in this repository, agents MUST adhere to these strict invariants:

### 1. Password Hashing: Strictly Argon2id
- **NEVER** use bcrypt, scrypt, SHA, MD5, or plain text.
- Always use `@node-rs/argon2` with `Algorithm.Argon2id`, `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1`.
- Output must strictly follow the standard PHC format: `$argon2id$v=19$...`.

### 2. Password Policy (Zod)
- Minimum 8 characters.
- Requires at least: 1 uppercase (`[A-Z]`), 1 lowercase (`[a-z]`), 1 number (`[0-9]`), 1 special character (`[^A-Za-z0-9]`).
- **No self-service "forgot password"**: password resets are performed exclusively by admins via `POST /api/iam/users/:id/reset-password` (`system:users:reset_password`).

### 3. Permission-First & Naming Format
- Every action, source query, and route requires explicit permission strings.
- **Format**:
  - System modules: `system:<modulo>:<acao>` (e.g. `system:users:create`, `system:workspaces:create`).
  - Recipe view: `recipe:<recipe_id>:view`
  - Recipe queries: `recipe:<recipe_id>:query:<nome>` (e.g. `recipe:fechamento_mes:query:all`)
  - Recipe actions: `recipe:<recipe_id>:action:<id>` (e.g. `recipe:fechamento_mes:action:adicionar_penalidade`)
- **Orphan Pruning**: When actions or queries are deleted from a recipe, `PermissionCatalogEngine.pruneOrphanPermissions` automatically purges them from all roles upon sync/boot.

### 4. Query Resolution Order
- Multiple queries defined on a source are evaluated **in the order of their declaration** in the recipe.
- The **first** query matching the authenticated user's permissions is selected. If no query matches, throw `403 Forbidden`.

### 5. Mandatory Workspace Dates & Temporal Protection
- Every Workspace / Área de Trabalho must have `start_date` and `end_date` (`YYYY-MM-DD`).
- **Strict Rule**: `end_date >= start_date`. Any request with `end_date < start_date` must be rejected with HTTP 400 and message `"A Data Final não pode ser anterior à Data Inicial."`.

### 6. Zero SQL Injection (Template Engine)
- **NEVER** concatenate user strings or raw variables into SQL queries.
- All `{{workspace.param}}` and `{{user.externals.source}}` tokens must be converted into bind parameters (`@p1`, `@p2`) via `TemplateEngine.parse()`.

### 7. Sandboxed Action Execution
- Actions execute in isolated `node:vm` contexts without access to Node globals (`process`, `fs`, `child_process`, `net`).
- Strict timeout of **5,000 ms** per action execution via `Promise.race`.

### 8. No Credential Leakage
- `passwordHash` must **never** be included in API responses. Always delete or omit `passwordHash` before returning `User` objects.

### 9. 100% Pure `shadcn/ui` Standard (No Raw HTML)
- Every UI element rendered in the application MUST be built exclusively with official `shadcn/ui` primitives located in `@/components/ui/*`.
- **Forms**: Always use `<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormMessage>` with `react-hook-form` and `zodResolver`.
- **Labels**: Always use `<Label>` from `@/components/ui/label`. Never use raw `<label>`.

### 11. Custom Tailwind `<div>` Components Prohibited Without Explicit Authorization
- **NEVER** create custom components or layout wrappers using custom-styled `<div>` tags without explicit prior approval from the user.
- All interface elements MUST use standard `shadcn/ui` components from `@/components/ui/*`.
- Any custom abstraction or layout decision requires prior explicit confirmation.

### 12. Strict Step-by-Step Explicit User Approval
- The agent must **NEVER** make unilateral decisions regarding layout, architecture, or logic.
- For **EVERY SINGLE STEP** to be performed, the agent MUST explicitly ask the user for permission and confirmation before executing that step.

### 13. Strict & Explicit TypeScript Typing (Zero `unknown`/`any` Workarounds)
- **NEVER** use defensive runtime type sniffing, `unknown`, or `any` when exact component signatures exist.
- Always use the exact, native types declared by the library (e.g., `(values: string[]) => void`).

### 14. Proibição Absoluta de Adivinhação & Consulta Obrigatória à Documentação Oficial em TUDO
- **O MODELO É DESATUALIZADO E O ECOSSISTEMA MUDA RAPIDAMENTE**: O modelo deve assumir como premissa mandatória que sua memória interna sobre APIs, bibliotecas, frameworks, versões e sintaxes é defasada ou propensa a alucinações.
- **SEMPRE consulte a documentação oficial para QUALQUER tópico**: Isso se aplica a **TUDO** (Frontend, Backend Hono, TypeScript, Zod, Argon2, Vite, shadcn/ui, Radix UI, Base UI, Tailwind CSS v4, PostgreSQL, Vitest, etc.), e não apenas a UI/Layout.
- **PROIBIDO inventar gambiarras ou soluções improvisadas**: Nunca utilize hacks, suposições de sintaxe, *inline styles*, classes arbitrárias ou soluções baseadas em "adivinhação". Utilize exclusivamente os padrões canônicos vigentes na documentação oficial.
- **Siga estritamente as instruções do usuário** e confirme cada ação passo a passo.

### 15. Button Size Convention (Never `sm` / `icon-sm`)
- For buttons with text: use `size="default"` (or omit — it's the default). **NEVER** use `size="sm"`, `size="xs"`, or `size="lg"` on action buttons.
- For icon-only buttons: use `size="icon"`. **NEVER** use `size="icon-sm"` or `size="icon-xs"`.
- The only exception is the internal `X` close button inside `SheetContent` (`size="icon-sm"`) — this is part of the primitivo and must NOT be replicated.
- Reference: `buttonVariants` sizes are `default` (`h-8`), `xs` (`h-6`), `sm` (`h-7`), `lg` (`h-9`), `icon`/`icon-xs`/`icon-sm`/`icon-lg`. Project convention uses exclusively `default` and `icon`.

### 16. Sheet Layout Convention
- Side: always `side="right"`.
- Content: `SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl"`.
- Header: `SheetHeader className="p-6 border-b shrink-0"` with `SheetTitle` + `SheetDescription`.
- Body: `ScrollArea className="flex-1 min-h-0"` wrapping a `<div className="p-6 flex flex-col gap-6">` (or `gap-4`).
- Footer: `SheetFooter className="p-6 border-t shrink-0 flex flex-row justify-end gap-2 bg-popover"` with `variant="outline"` Cancel + primary submit.
- Submit pattern: `form="role-form"` on the submit button, `<form id="role-form">` inside the scroll area.
- Reference: `IAMRolesPage.tsx`, `RecipePermissionsSheet.tsx`.

### 17. Permission Management Separation (System vs Recipe)
- **System permissions** (`system:*`) are configured in the Roles page (`/iam/roles`) via the edit Sheet.
- **Recipe permissions** (`recipe:*`) are configured on each Model's page (`/recipes/:recipeId`) via `RecipePermissionsSheet`.
- The Roles page edit Sheet shows ONLY `system:*` modules. A muted note informs that recipe permissions are configured per Model.
- The RecipePermissionsSheet lists all roles with Collapsibles; each expands to show the recipe's declared permissions (view, queries, actions) with Switch toggles.
- Server-side validation: `POST /api/iam/roles` and `PUT /api/iam/roles/:id` validate permission keys against `PermissionCatalogEngine.getAllValidPermissionKeys()`. Invalid keys return HTTP 400. Wildcard `"*"` is allowed.

### 18. Search Inputs via `InputGroup` (No Custom `<div>` Wrappers)
- Search inputs and inputs with icons MUST use the canonical `InputGroup` primitives (`InputGroup`, `InputGroupAddon`, `InputGroupInput`) from `@/components/ui/input-group`.
- **NEVER** build custom search containers with `<div className="relative">` and absolute positioned icons.

### 19. Currency & Money Input Standard (`MoneyInput`)
- All form fields of type `money` (declarative or imperative `ui.dialog.open`) MUST use `<MoneyInput />` from `@/components/ui/money-input`.
- **NEVER** use `<Input type="number" step="0.01" />` for currency.
- `MoneyInput` enforces `type="text"`, `inputMode="numeric"` (opening touch numeric keyboard on mobile devices) and real-time cents-based masking in Brazilian Real (`R$ 0,00`), with full support for `prefix`, `precision`, `allowNegative` and typed float synchronization with the backend.

### 20. Mobile Responsive Tables via `MobileCard`
- All data tables (`SDUITable`, `WorkspacesPage`, `IAMUsersPage`, `IAMRolesPage`, `showTable`) must implement adaptive rendering via `useIsMobile()`:
  - **Desktop**: Full `<Table>` with `<TableHeader>`, `<TableBody>`, `<TableCell>` and sorting/pagination controls.
  - **Mobile**: Grid of `<MobileCard>` elements with primary title, secondary subtitle, structured fields list, and action buttons.

### 21. Granular One-Line Conventional Commits & Mandatory Approval
- All commits in this repository MUST strictly follow the **One-Line Conventional Commits** format: `<type>(<scope>): <short description in english>` (e.g. `fix(web): filter showTable rowActions by user permissions`).
- Granularity: Commits must be separated logically by responsibility/component.
- **NEVER** execute commits unilaterally. The agent MUST ALWAYS:
  1. Present the detailed commit plan (messages and corresponding files) to the user.
  2. Request explicit user confirmation.
  3. Execute `git commit` ONLY after user approval.

---

## 4. Code Generation Recipes & Templates

### A. Creating a New Recipe (`.recipe.ts`)

```typescript
import { defineRecipe } from "@platform/shared";

export default defineRecipe({
  id: "comissoes_vendas",
  name: "Comissões de Vendas",
  description: "Apuração e cálculo de comissões por vendedor.",

  workspace: {
    params: [
      { name: "start_date", label: "Data Inicial", type: "date", required: true },
      { name: "end_date", label: "Data Final", type: "date", required: true },
    ],
  },

  sources: {
    inovafarma: {
      primaryKey: "vendedor_id",
      queries: {
        all: {
          id: "q_comissoes_all",
          query: `
            SELECT v.id AS vendedor_id, v.nome AS vendedor, SUM(vendas.valor) AS total_vendas
            FROM vendas
            INNER JOIN vendedores v ON vendas.vendedor_id = v.id
            WHERE vendas.data BETWEEN {{workspace.start_date}} AND {{workspace.end_date}}
            GROUP BY v.id, v.nome
          `,
          columns: [
            { name: "vendedor_id", type: "int", label: "ID" },
            { name: "vendedor", type: "string", label: "Vendedor" },
            { name: "total_vendas", type: "money", label: "Total Vendas" },
          ],
        },
        self: {
          id: "q_comissoes_self",
          query: `
            SELECT v.id AS vendedor_id, v.nome AS vendedor, SUM(vendas.valor) AS total_vendas
            FROM vendas
            INNER JOIN vendedores v ON vendas.vendedor_id = v.id
            WHERE vendas.data BETWEEN {{workspace.start_date}} AND {{workspace.end_date}}
              AND v.id = {{user.externals.inovafarma}}
            GROUP BY v.id, v.nome
          `,
          columns: [
            { name: "vendedor_id", type: "int", label: "ID" },
            { name: "vendedor", type: "string", label: "Vendedor" },
            { name: "total_vendas", type: "money", label: "Total Vendas" },
          ],
        },
      },
    },
  },

  persistence: [
    {
      id: "ajustes_comissao",
      targetSource: "inovafarma",
      targetForeignKey: "vendedor_id",
      mode: "collection",
      itemSchema: {
        valor: { type: "money", label: "Valor (R$)", defaultValue: 0 },
        motivo: { type: "text", label: "Motivo", defaultValue: "" },
      },
      computedFields: {
        total_ajustes: {
          type: "money",
          aggregate: { function: "sum", field: "valor" },
        },
      },
    },
  ],

  actions: [
    {
      id: "adicionar_ajuste",
      label: "Adicionar Ajuste",
      icon: "PlusCircle",
      permission: "recipe:comissoes_vendas:action:adicionar_ajuste",
      action: async ({ row, ui, persistence }) => {
        const form = await ui.dialog.open({
          title: "Adicionar Ajuste de Comissão",
          fields: [
            { name: "vendedor", label: "Vendedor", type: "text", readOnly: true, defaultValue: row.vendedor },
            { name: "valor", label: "Valor (R$)", type: "money", required: true, defaultValue: 10 },
            { name: "motivo", label: "Motivo", type: "textarea", required: true },
          ],
        });
        if (!form) return;

        await persistence.push("ajustes_comissao", {
          valor: form.valor,
          motivo: form.motivo,
        });
        ui.toast.success("Ajuste registrado com sucesso!");
        ui.refresh();
      },
    },
  ],

  ui: {
    layout: { type: "grid", columns: 12, gap: 16 },
    components: [
      {
        id: "kpi_total_vendas",
        component: "stat_card",
        layoutProps: { colSpan: 6 },
        props: {
          title: "Total Geral de Vendas",
          source: "inovafarma",
          aggregate: { function: "sum", field: "total_vendas" },
          format: "currency",
          icon: "DollarSign",
        },
      },
      {
        id: "tabela_comissoes",
        component: "data_table",
        layoutProps: { colSpan: 12 },
        props: {
          title: "Apuração de Comissões por Vendedor",
          source: "inovafarma",
          columns: [
            { key: "vendedor_id", label: "ID", sortable: true },
            { key: "vendedor", label: "Vendedor", sortable: true, searchable: true },
            { key: "total_vendas", label: "Total Vendas", format: "currency", sortable: true },
            { key: "ajustes_comissao.total_ajustes", label: "Ajustes", format: "currency", sortable: true },
            {
              key: "comissao_final",
              label: "Comissão Final (5%)",
              format: "currency",
              sortable: true,
              compute: (row) => Number(row.total_vendas || 0) * 0.05 + Number(row.ajustes_comissao?.total_ajustes || 0),
            },
          ],
          rowActions: ["adicionar_ajuste"],
          pagination: { pageSize: 10 },
        },
      },
    ],
  },
});
```

---

## 5. Development & Testing Commands

```bash
# Build all packages in monorepo
pnpm -r run build

# Run entire Vitest test suite
pnpm test

# Run tests in watch mode
pnpm --filter @platform/server test:watch
```
