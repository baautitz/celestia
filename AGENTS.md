# AGENTS.md — Technical Architecture & Operational Directives for AI Agents

> **Audience**: Autonomous Coding Agents (Claude Code, Antigravity, Cursor, Copilot, Cline, Windsurf).
> **Platform**: Celestia — Permission-First IAM Enterprise Platform (small core + modules).
> **Runtime**: Node.js >= 24.x, TypeScript >= 5.6 (strict mode), pnpm workspaces.

---

## 1. System Identity

**Celestia** is an enterprise platform with an embedded **Permission-First IAM**, built for high-stakes operations (monthly closings, retail auditing, sales commissions, pharmacy/ERP reconciliations).

- **Backend**: [Hono](https://hono.dev/) on Node.js. **Security**: Argon2id, stateless JWT (5 min) + Refresh Token (7 days).
- **Frontend**: Vite + React 19 + shadcn/ui + Tailwind CSS v4.
- **Recipes / SDUI were removed.** Customer-specific features will be modules under `/integrations` (a definir). The Closing Period ("Período de Fechamento", formerly Workspace/Área de Trabalho) is already a Plugin Module (`closing_period`).
- **Target architecture** (modules as bounded contexts, `before`/`after` events, per-module migrations): see the GitHub issues, the ADRs in [docs/adr/](docs/adr/) and the glossaries ([GLOSSARY-MAP.md](GLOSSARY-MAP.md)). Not implemented yet.

---

## 2. Monorepo Map

```text
celestia/
├── packages/
│   ├── core/     (@platform/core)   module framework: contract, loader/graph, events, migrations, permissions (pruneOrphans, ...)
│   ├── shared/   (@platform/shared) contracts & types: iam.ts, workspace.ts, erp.ts, fields.ts
│   ├── server/   (@platform/server) Hono API
│   │   └── src/  index.ts (app: health, auth, iam, /api/admin/connections*, /api/admin/erp-types, /api/closing-periods*),
│   │             iam/, closing-period/ (Plugin: module, permissions, stores, schema, own drizzle/ migrations), engine/ (template-engine), data/ (connectors, stores, secret-box, read-only-guard),
│   │             db/ (drizzle schema, client, migrate), cli/ (create-admin, erp-query)
│   ├── ui/       (@platform/ui)     shadcn/ui primitives, imperative UI (useUi), DataTable, forms, defineWebModule
│   └── web/      (@platform/web)    SPA: modules.ts registry, pages IAMUsers/IAMRoles/ERPs/Login
├── docs/         adr/, conventions/, ideas/, agents/
└── scripts/      check-ui-boundaries.mjs
```

Migrations live in `packages/server/drizzle/`. The database is rebuilt module by module later.

---

## 3. Commands

```bash
pnpm -r run build      # build all (server depends on shared and core via dist; pnpm -r orders them)
pnpm test              # full Vitest suite
pnpm test:db           # suite + integration tests (runner, stores) against a throwaway Docker Postgres (127.0.0.1, random port, removed at the end)
pnpm check:ui          # UI boundary check
pnpm --filter @platform/server test:watch
```

Building one package alone: build `@platform/shared` and `@platform/core` first.

---

## 4. Invariants (Non-Negotiable)

### Security
- **Passwords**: only Argon2id via `@node-rs/argon2` (`memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`), PHC format `$argon2id$v=19$...`. Never bcrypt/scrypt/SHA/MD5/plain text.
- **Password policy (Zod)**: min 8 chars, with 1 uppercase, 1 lowercase, 1 number, 1 special. No self-service "forgot password": admins reset via `POST /api/iam/users/:id/reset-password` (`system:users:reset_password`).
- **No credential leakage**: never return `passwordHash`; omit it from every `User` response.
- **Zero SQL injection**: never concatenate user strings into SQL. All `{{...}}` tokens become bind parameters (`@p1`, `@p2`) via `TemplateEngine.parse()` (`engine/template-engine.ts`).
- **Session (zero `localStorage`)**: the access token lives only in JS memory; the refresh token only in an `HttpOnly; SameSite=Lax; Path=/api/auth` cookie, handled with `getCookie`/`setCookie`/`deleteCookie` from `hono/cookie`. Never store tokens or credentials in `localStorage`/`sessionStorage`.

### Permissions
- Every action and route requires an explicit permission string. Naming guidance: [docs/conventions/permissions.md](docs/conventions/permissions.md).
- Format `system:<modulo>:<acao>` (e.g. `system:users:create`). Valid keys are exactly `SYSTEM_PERMISSIONS` plus the wildcard `"*"` (admin only). Module formats: a definir.
- **Orphan pruning**: at boot, `UserStore.syncOrphanPermissions(validKeys)` removes every key not in `SYSTEM_PERMISSION_KEYS` from all roles (keeps `"*"`; uses `pruneOrphans` from `@platform/core/permissions`).
- **Role validation**: `POST /api/iam/roles` and `PUT /api/iam/roles/:id` reject invalid keys with HTTP 400. `GET /api/iam/permissions/catalog` returns `{ system }`. System permissions are configured in `/iam/roles` (edit Sheet).
- **Administrator bypass (`isAdmin`)**: `users.is_admin = true` ignores the permission matrix; the auth middleware swaps the token's permissions for every key in `SYSTEM_PERMISSIONS` at request time, so `requirePermission` keeps working unchanged. Settable only via `UserStore.setAdmin`: by the `create-admin` CLI, or `PUT /api/iam/users/:id` with `isAdmin`, accepted only from a caller who is already admin (403 otherwise) and never lets an admin demote themselves (400). `POST /api/iam/users` ignores it. This is the single deliberate exception to least-privilege; grant sparingly.

### Domain
- A Closing Period is a contiguous range of dates (`startDate`/`endDate`, `YYYY-MM-DD`, any length); `POST /api/closing-periods` takes `{ name, startDate, endDate }` and needs `closing_period:period:create` (`GET` needs `closing_period:period:read`). `endDate < startDate` → HTTP 400 `"A Data Final não pode ser anterior à Data Inicial."`. A date belongs to at most one Closing Period (open or closed): a period sharing any date with another → HTTP 400. Unknown id → 404. Its migrations live in `packages/server/src/closing-period/drizzle` (generate with `drizzle-kit generate --config=drizzle.closing-period.config.ts --name=<descricao>`).

### UI
Details in [docs/conventions/ui.md](docs/conventions/ui.md).
- Build every element from `@platform/ui/components/*`; no raw HTML, no custom-styled `<div>` components or wrappers without explicit user approval, no inline styles or arbitrary classes. `pnpm check:ui` enforces the package boundary.
- Forms: `Form*` primitives + `react-hook-form` + `zodResolver`; always `<Label>`. Money: `<MoneyInput />`. Search/icon inputs: `InputGroup`. Tables: `DataTable`. Windows, confirmations and toasts: `useUi()`.
- Buttons: `size="default"` or `size="icon"` only (never `sm`/`xs`/`lg`/`icon-sm`/`icon-xs`).
- Sheets: the window renders only the body and publishes actions with `<WindowActions>`.
- Light theme only.

### Code
- **Strict TypeScript**: no `any`, `unknown` workarounds or runtime type sniffing when the library declares exact types.
- **Official docs first**: the model's memory of APIs, versions and syntax is stale. Consult the official documentation for anything (Hono, Zod, Vite, shadcn/ui, Base UI, Tailwind v4, PostgreSQL, Vitest, ...). No hacks or guessed syntax.
- **Migrations** have descriptive snake_case names: `pnpm --filter @platform/server db:generate --name=<descricao>`; apply with `db:migrate`. Never keep auto-generated random names.

---

## 5. Working Agreement

- **Explicit approval**: do not make unilateral decisions on layout, architecture or logic. Present each step, explain it, and get the user's confirmation before executing it.
- **Commits** are One-Line Conventional Commits: `<type>(<scope>): <short description in english>` (e.g. `fix(web): filter showTable rowActions by user permissions`), split by responsibility. Never commit unilaterally: present the plan (messages + files), get confirmation, then commit.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`baautitz/celestia`, via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: root `GLOSSARY-MAP.md` points to per-context `GLOSSARY.md` files under `packages/*`. See `docs/agents/domain.md`.
