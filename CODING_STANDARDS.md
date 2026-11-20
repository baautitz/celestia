# Coding Standards

Reference for code review (`/code-review`) and architectural judgement calls across the Celestia monorepo.

## Context Pointers

- **Domain vocabulary** — [GLOSSARY-MAP.md](GLOSSARY-MAP.md): read when naming symbols, routes, tables, UI labels, or Audit Log entries (`Closing Period`, `Cancel`/`Close`/`Reopen`, `ERP`, `ERP Driver`, `User`, `Role`, `Deactivate`, `Permission`, `Administrator`, `Audit Log`, `Log Entry`).
- **UI primitives and imperative windows** — [docs/conventions/ui.md](docs/conventions/ui.md): read when reviewing `packages/web`, `packages/ui`, or `integrations/*/src/web.tsx` (primitives from `@platform/ui/components/*`, `useUi()` windows/sheets/confirmations/toasts, `<WindowActions>`, `<HeaderActions>`, `<DataTable>`, `Form*` + `<Label>`, `<MoneyInput />`, `<InputGroup>`, `<Button size="default" | "icon">`).
- **Permission and event naming** — [docs/conventions/permissions.md](docs/conventions/permissions.md): read when reviewing `definePermissions`, `guarded`, `byPermission`, permission catalogs, or `before`/`after` module events (`<module>:<resource>:<verb>`, `deniedMessage` in PT-BR, fail-closed `before` handlers).
- **Customer Plugins** — [docs/conventions/plugins.md](docs/conventions/plugins.md): read when reviewing `integrations/*`, `packages/server/src/plugins.ts`, or `packages/web/src/modules.ts` (package boundaries, dependency injection via `createXPlugin`, static registration).
- **Component and E2E tests** — [docs/conventions/testing.md](docs/conventions/testing.md): read when reviewing `*.test.ts`, `*.test.tsx`, or `packages/e2e/tests/*.e2e.ts` (role/label queries, in-memory Hono E2E server, login-per-test flow).

## Judgement Calls

### Registry-Driven Module Composition
Derive cross-cutting lists from the registered Modules (`composeModules` in `packages/server/src/boot/compose.ts`) rather than hardcoded module arrays:
- **Permission catalog & validation**: `GET /api/iam/permissions/catalog` (`{ system, modules }`), Role permission validation, and boot-time orphan pruning (`UserStore.syncOrphanPermissions`) collect keys from every registered Module.
- **Administrator bypass (`isAdmin`)**: grant every Permission key declared across the registered Modules plus `"*"`.
- **Route forwarding**: mount and forward prefixes from the registered Modules (`def.prefix ?? /api/m/${def.id}`).

### Optimistic Concurrency on Versioned Entities
State transitions and edits on versioned domain records (such as Closing Period `update`, `close`, and `reopen`) verify the expected `version` in the store mutation, increment `version` atomically, and return HTTP 409 on conflict.

### Bounded In-Memory State
Any in-memory map, rate-limiter bucket, or cache keyed by external input (IP address, username, token) enforces a maximum entry capacity and evicts expired or oldest entries before inserting.

### Security & Data Boundaries
- **Credentials and secrets**: omit `passwordHash` from every `User` payload and keep ERP credentials encrypted via `SecretBox`; never log or return raw secrets.
- **Parameterized SQL**: parse every `{{...}}` template token into bind parameters (`@p1`, `@p2`) via `TemplateEngine.parse()` (`packages/server/src/engine/template-engine.ts`) and guard ERP queries with `assertReadOnlySql`.
- **Session isolation**: keep the access token in JS memory only and the refresh token in an `HttpOnly; SameSite=Lax; Path=/api/auth` **session cookie** (no `Max-Age`). The refresh token is opaque (32 random bytes) and the database stores only its SHA-256 hash (`iam.sessions`). Rotate it on every use; reusing an already-used token outside the grace window (`SESSION_REUSE_GRACE_SECONDS`, default 30) revokes the whole family. Logout revokes only the current family; `session_version` still bumps on password reset, deactivation, or Role change.
- **Session limits**: the family has an absolute lifetime (`SESSION_ABSOLUTE_SECONDS`, default 12 h) and an idle limit (`SESSION_IDLE_SECONDS`, default 30 min). The client locks the screen on idle and tells the server (`POST /auth/lock`); a locked session refuses `/auth/refresh` (401 `session_locked`) until `POST /auth/unlock` with the user's password. The server is the authority: a page reload never unlocks. Never measure idleness with polling or background requests.

### Type Discipline
Write strict TypeScript against the exact types declared by libraries and `@platform/shared` / `@platform/core` contracts (for example, pass a real `LucideIcon` in navigation tests rather than casting a dummy function via `any` or `as unknown as`).
