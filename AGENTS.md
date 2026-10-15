# AGENTS.md — Technical Architecture & Operational Directives for AI Agents

> **Audience**: Autonomous Coding Agents, Antigravity, Claude Code, Cursor, Copilot, Cline, Windsurf.  
> **Platform**: Celestia — Permission-First IAM Enterprise Platform (modular; modules a definir).  
> **Runtime**: Node.js >= 24.x, TypeScript >= 5.6 (strict mode), pnpm workspaces.

---

## 1. System Identity & Mission

**Celestia** is an enterprise platform with an embedded **Permission-First IAM** system, designed for high-stakes enterprise operations (monthly closings, retail auditing, sales commissions, pharmacy/ERP reconciliations).

> **Recipes / SDUI were REMOVED** (user decision). There is no recipe compiler, sandbox, dashboards or recipe permissions (`recipe:*`) anymore. Customer-specific functionality will come as modules under `/integrations` (a definir). **Workspaces will become a module** (`workspaces`, a definir); today they remain in the server without any model link (`recipe_id`/`params` dropped).

- **Backend**: [Hono](https://hono.dev/) on Node.js (ultra-fast, typed RPC, minimal overhead).
- **Security**: **Argon2id** (`@node-rs/argon2`), stateless JWT (5 min) + Refresh Token (7 days).
- **Frontend**: Vite + React 19 + shadcn/ui + Tailwind CSS v4.
- **PT-BR UI Terminology**:
  - `Workspace` ➔ **Área de Trabalho** (the active session/closing period).

---

## 2. Monorepo Map

```text
celestia/
├── packages/
│   ├── core/                     (@platform/core) -> Module framework: module contract, loader/graph, events, migrations, permissions (pruneOrphans, ...)
│   ├── shared/                   (@platform/shared) -> Contracts & types: iam.ts, workspace.ts, erp.ts, fields.ts (re-export of @platform/ui)
│   ├── server/                   (@platform/server) -> Hono API
│   │   └── src/
│   │       ├── index.ts          -> Hono app: health, auth, iam, /api/admin/connections*, /api/admin/erp-types, /api/workspaces*
│   │       ├── iam/              -> password-service, token-service, system-permissions (SYSTEM_PERMISSIONS, SYSTEM_PERMISSION_KEYS, denyMessage),
│   │       │                        user-store (memory) / postgres-user-store, middleware, has-permission, can-grant
│   │       ├── engine/           -> template-engine (SQL {{...}} -> bind params), workspace-validator
│   │       ├── data/             -> source-connector, mssql-source-connector, connection-factory/store, erp-types, secret-box, read-only-guard, workspace-store
│   │       ├── db/               -> drizzle schema (roles, users, connections, workspaces), client, migrate
│   │       └── cli/              -> create-admin, erp-query
│   ├── ui/                       (@platform/ui) -> shadcn/ui primitives, imperative UI (useUi), DataTable, forms, contracts (defineWebModule)
│   └── web/                      (@platform/web) -> SPA (Vite + React 19): modules.ts registry, pages IAMUsers/IAMRoles/ERPs/Login
```

Migrations live in `packages/server/drizzle/`. The database is rebuilt module by module later (a definir).

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
- Convenção de verbos e nomes (orientação, não obrigatória): [docs/conventions/permissions.md](docs/conventions/permissions.md).
- Every action, source query, and route requires explicit permission strings.
- **Format**:
  - System modules: `system:<modulo>:<acao>` (e.g. `system:users:create`, `system:workspaces:create`).
  - Valid keys are exactly `SYSTEM_PERMISSIONS` (+ the wildcard `"*"`). Module permission formats beyond `system:*`: a definir.
- **Orphan Pruning**: at boot, `UserStore.syncOrphanPermissions(validKeys)` removes from all roles every key not in `SYSTEM_PERMISSION_KEYS` (the wildcard `"*"` is preserved; uses `pruneOrphans` from `@platform/core/permissions`).
- **Administrator bypass (`isAdmin`)**: a user with `users.is_admin = true` ignores the permission matrix. The auth middleware replaces the token's permissions with **every valid permission key at request time** (`SYSTEM_PERMISSIONS`), so every `requirePermission` / `permissions.includes(...)` check keeps working unchanged. The flag is settable only via `UserStore.setAdmin`: by the `create-admin` CLI, or by `PUT /api/iam/users/:id` with `isAdmin`, which is accepted ONLY from a caller who is already an admin (403 otherwise) and never lets an admin demote themselves (400). `POST /api/iam/users` ignores it. This is the single, deliberate exception to least-privilege: grant it sparingly.

### 5. Mandatory Workspace Dates & Temporal Protection
- Every Workspace / Área de Trabalho must have `startDate` and `endDate` (`YYYY-MM-DD`); `POST /api/workspaces` takes `{ name, startDate, endDate }`.
- **Strict Rule**: `end_date >= start_date`. Any request with `end_date < start_date` must be rejected with HTTP 400 and message `"A Data Final não pode ser anterior à Data Inicial."`.

### 6. Zero SQL Injection (Template Engine)
- **NEVER** concatenate user strings or raw variables into SQL queries.
- All `{{...}}` tokens (e.g. `{{workspace.param}}`, `{{user.externals.source}}`) must be converted into bind parameters (`@p1`, `@p2`) via `TemplateEngine.parse()` (`engine/template-engine.ts`; used by connections/modules).

### 8. No Credential Leakage
- `passwordHash` must **never** be included in API responses. Always delete or omit `passwordHash` before returning `User` objects.

### 9. `@platform/ui` Primitives Only (No Raw HTML)
- Every UI element is built from `@platform/ui/components/*` (shadcn/ui, Base UI). The legacy `@/components/ui` no longer exists.
- **Forms**: `<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormMessage>` with `react-hook-form` and `zodResolver`.
- **Labels**: always `<Label>`; never raw `<label>`.
- **Theme**: light-only (no theme provider).
- **Boundary**: outside `packages/ui`, `pnpm check:ui` forbids importing `sonner` or `@base-ui/react/*`, `@/components/ui`, and declarative `open=`/`onOpenChange=` on Dialog/Sheet/AlertDialog/Popover.

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
- Sheets are opened via the `"sheet"` surface of `useUi().windows.open`; the window host in `@platform/ui` implements the layout, so the window component renders ONLY the body and publishes its actions with `<WindowActions>`.
- Host layout: `SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl"`; `SheetHeader className="p-6 border-b shrink-0"` (`SheetTitle` + `SheetDescription`); `ScrollArea className="flex-1 min-h-0"` > `<div className="p-6 flex flex-col gap-6">`; `SheetFooter className="p-6 border-t shrink-0 flex flex-row justify-end gap-2 bg-popover"`.
- Submit pattern: the action button uses `form="<id>"` and the body renders `<form id="<id>">`.

### 17. Permission Management
- **System permissions** (`system:*`) are configured in the Roles page (`/iam/roles`) via the edit Sheet. Where module permissions will be configured: a definir.
- Server-side validation: `POST /api/iam/roles` and `PUT /api/iam/roles/:id` validate permission keys against `SYSTEM_PERMISSION_KEYS`. Invalid keys return HTTP 400. Wildcard `"*"` is allowed (admin only).
- `GET /api/iam/permissions/catalog` returns `{ system }`.

### 18. Search Inputs via `InputGroup` (No Custom `<div>` Wrappers)
- Search inputs and inputs with icons MUST use the canonical `InputGroup` primitives (`InputGroup`, `InputGroupAddon`, `InputGroupInput`) from `@/components/ui/input-group`.
- **NEVER** build custom search containers with `<div className="relative">` and absolute positioned icons.

### 19. Currency & Money Input Standard (`MoneyInput`)
- All form fields of type `money` (declarative or imperative `ui.dialog.open`) MUST use `<MoneyInput />` from `@/components/ui/money-input`.
- **NEVER** use `<Input type="number" step="0.01" />` for currency.
- `MoneyInput` enforces `type="text"`, `inputMode="numeric"` (opening touch numeric keyboard on mobile devices) and real-time cents-based masking in Brazilian Real (`R$ 0,00`), with full support for `prefix`, `precision`, `allowNegative` and typed float synchronization with the backend.

### 20. Data Tables via `DataTable`
- Data tables use `DataTable` from `@platform/ui/data-table/data-table`: desktop renders `<Table>`; mobile renders `<MobileCard>` via `useIsMobile()`.

### Imperative UI (`useUi()`)
- Windows (dialogs/sheets), confirmations and feedback (toasts) are opened imperatively through `useUi()` from `@platform/ui/imperative/provider`, mounted once by `UiProvider` in `main.tsx`.
- Window content uses `useWindow()` and `WindowActions` (footer actions) from `@platform/ui/imperative/use-window`.

### 21. Granular One-Line Conventional Commits & Mandatory Approval
- All commits in this repository MUST strictly follow the **One-Line Conventional Commits** format: `<type>(<scope>): <short description in english>` (e.g. `fix(web): filter showTable rowActions by user permissions`).
- Granularity: Commits must be separated logically by responsibility/component.
- **NEVER** execute commits unilaterally. The agent MUST ALWAYS:
  1. Present the detailed commit plan (messages and corresponding files) to the user.
  2. Request explicit user confirmation.
  3. Execute `git commit` ONLY after user approval.

### 22. Named Drizzle Migrations
- Every migration MUST have a descriptive snake_case name: `pnpm --filter @platform/server db:generate --name=<descricao>` (e.g. `--name=create_users_and_roles`). Never keep the auto-generated random names (e.g. `white_phantom_reporter`).
- Apply with `pnpm --filter @platform/server db:migrate`. Migrations live in `packages/server/drizzle/`.

---

## 3b. Arquitetura alvo (PLANEJADO, NAO implementado)

- Modulos como bounded contexts, cada um com migrations proprias.
- Comunicacao entre modulos por eventos `before` (cancelavel) e `after`.
- Registro de modulos no web (hoje parcial: `modules.ts` + `modules/core.ts`).
- Demais detalhes: a definir.

---

## 4. Code Generation Templates

Removed together with Recipes. New templates (modules under `/integrations`, `workspaces` module): a definir.

---

## 5. Development & Testing Commands

```bash
# Build all packages in monorepo
pnpm -r run build
# Note: server depends on shared and core via dist; `pnpm -r` orders them topologically.
# Building one package alone: run `pnpm --filter @platform/shared build` and
# `pnpm --filter @platform/core build` before the server (build/test/dev).

# Run entire Vitest test suite
pnpm test

# UI boundary check
pnpm check:ui

# Run tests in watch mode
pnpm --filter @platform/server test:watch
```
