# AGENTS.md — Technical Architecture & Operational Directives for AI Agents

> **Audience**: Autonomous Coding Agents (Claude Code, Antigravity, Cursor, Copilot, Cline, Windsurf).
> **Platform**: Celestia — Permission-First IAM Enterprise Platform (small core + modules).
> **Runtime**: Node.js >= 24.x, TypeScript >= 5.6 (strict mode), pnpm workspaces.

---

## 1. System Identity

**Celestia** is an enterprise platform with an embedded **Permission-First IAM**, built for high-stakes operations (monthly closings, retail auditing, sales commissions, pharmacy/ERP reconciliations).

- **Backend**: [Hono](https://hono.dev/) on Node.js. **Security**: Argon2id, stateless JWT (5 min) + Refresh Token (7 days).
- **Frontend**: Vite + React 19 + shadcn/ui + Tailwind CSS v4 (light theme only).
- **Architecture**: Small core (`@platform/core`) loading Base System modules (`iam`, `audit`), built-in Plugin modules (`closing_period`, `erp`), and customer Plugins under `integrations/*`. See ADRs in [docs/adr/](docs/adr/), domain glossaries in [GLOSSARY-MAP.md](GLOSSARY-MAP.md), and review standards in [CODING_STANDARDS.md](CODING_STANDARDS.md).

---

## 2. Monorepo Map

```text
celestia/
├── packages/
│   ├── core/     (@platform/core)   module framework: defineModule, loader/graph, events, migrations, permissions (definePermissions, pruneOrphans)
│   ├── shared/   (@platform/shared) contracts & types: iam.ts, closing-period.ts, audit.ts, erp.ts, fields.ts
│   ├── server/   (@platform/server) Hono API
│   │   └── src/  index.ts, boot/compose.ts, plugins.ts,
│   │             iam/ (module, permissions, initial-roles, auth, stores, schema, migrations/, login-rate-limiter),
│   │             audit/ (module, audit-log, stores, schema, migrations/),
│   │             closing-period/ (Plugin: module, permissions, audit, stores, schema, migrations/),
│   │             erp/ (Plugin: module, permissions, drivers, clients, externals, stores, secret-box, read-only-guard, schema, migrations/),
│   │             engine/ (template-engine), db/ (client, migrate), cli/ (create-admin, erp-query)
│   ├── ui/       (@platform/ui)     shadcn/ui primitives, imperative UI (useUi, WindowActions), DataTable, forms, defineWebModule
│   ├── web/      (@platform/web)    SPA: modules.ts registry, pages (Login, IAMUsers, IAMRoles, ERPs, ClosingPeriodsPage, AuditLogPage)
│   └── e2e/      (@platform/e2e)    Playwright E2E suite against in-memory Hono API + Vite SPA
├── integrations/ Customer Plugins (e.g. integrations/inovafarma); boundary checked by `pnpm check:plugins`
├── docs/         adr/, conventions/ (database, ui, permissions, plugins, testing), agents/, security-audit.md
└── scripts/      check-ui-boundaries.mjs, check-plugin-boundaries.mjs, test-db.mjs
```

---

## 3. Commands

See [package.json](package.json) for all workspace scripts:

```bash
pnpm build             # build all packages (server depends on shared and core dist)
pnpm test              # Vitest unit & component suite
pnpm test:db           # Vitest suite + Postgres integration tests (throwaway Docker Postgres)
pnpm db:migrate        # apply all Module migrations in dependency order
pnpm create-admin      # create or promote (--force) an Administrator user
pnpm test:e2e          # Playwright E2E suite
pnpm lint              # ESLint across workspaces
pnpm check:ui          # UI boundary check
pnpm check:plugins     # Plugin boundary check (integrations import only @platform/core and @platform/ui)
```

---

## 4. Invariants & Context Pointers

- **Domain vocabulary** — [GLOSSARY-MAP.md](GLOSSARY-MAP.md): read before naming symbols, routes, tables, UI labels, or Audit Log entries.
- **Coding & review standards** — [CODING_STANDARDS.md](CODING_STANDARDS.md): registry-driven Module composition (`boot/compose.ts`), optimistic concurrency (`version` → HTTP 409), bounded in-memory state, security boundaries (Argon2id, `TemplateEngine.parse()`, `HttpOnly` refresh cookie + `session_version`), and strict TypeScript.
- **Database & Bootstrap** — [docs/conventions/database.md](docs/conventions/database.md): per-Module Postgres schema and `migrations/` directory, `pnpm db:migrate`, initial Roles (`gestor`, `operador`), and `pnpm create-admin`.
- **Permissions & Events** — [docs/conventions/permissions.md](docs/conventions/permissions.md): `<module>:<resource>:<verb>` naming, `deniedMessage` in PT-BR, and `before`/`after` module events.
- **UI** — [docs/conventions/ui.md](docs/conventions/ui.md): primitives from `@platform/ui/components/*`, `useUi()` windows/sheets with `<WindowActions>`, `<HeaderActions>`, `<DataTable>`, `Form*` + `<Label>`, `<MoneyInput />`, `<InputGroup>`, `<Button size="default" | "icon">`. Enforced by `pnpm check:ui`.
- **Plugins** — [docs/conventions/plugins.md](docs/conventions/plugins.md): customer Plugins under `integrations/<name>/`, registered in `packages/server/src/plugins.ts` and `packages/web/src/modules.ts`. Enforced by `pnpm check:plugins`.
- **Testing** — [docs/conventions/testing.md](docs/conventions/testing.md): Vitest component tests (`jsdom`) and Playwright E2E (`packages/e2e`) querying by role/label.

---

## 5. Working Agreement

- **Explicit approval**: do not make unilateral decisions on layout, architecture or logic. Present each step, explain it, and get the user's confirmation before executing it.
- **Commits** are One-Line Conventional Commits: `<type>(<scope>): <short description in english>`, split by responsibility. Never commit unilaterally: present the plan (messages + files), get confirmation, then commit.
  - Exception: integration merges into `main` are `--no-ff` merge commits with git's default message (see [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)); they are not one-line Conventional Commits.

## Agent skills

- **Issue tracker**: GitHub Issues (`baautitz/celestia`, via `gh` CLI). See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).
- **Triage labels**: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).
- **Domain docs**: root [GLOSSARY-MAP.md](GLOSSARY-MAP.md) points to per-context `GLOSSARY.md` files under `packages/*`. See [docs/agents/domain.md](docs/agents/domain.md).
