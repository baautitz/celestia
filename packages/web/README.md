# @platform/web

SPA do Celestia (Vite, React 19, Tailwind CSS v4). Os primitivos de interface vêm de `@platform/ui`; para adicionar ou alterar componentes, janelas, tabelas e formulários, siga [docs/conventions/ui.md](../../docs/conventions/ui.md) (verificado por `pnpm check:ui`).

- Módulos do SPA: `src/modules.ts`.
- Dev: `pnpm dev:web` (a partir da raiz), proxy de `/api` para `API_PROXY_TARGET` (padrão `http://localhost:3000`).
- Build: `pnpm --filter @platform/web build`.
