# Celestia

Plataforma corporativa com IAM permission-first: um core pequeno, onde funcionalidades entram como módulos.

O motor de Recipes/SDUI foi removido. Módulos de cliente ficarão em `/integrations` (planejado, ainda não existe).

## Monorepo

| Pacote | Conteúdo |
|---|---|
| `packages/core` (`@platform/core`) | Framework de módulos: contrato, loader, eventos, permissões |
| `packages/server` (`@platform/server`) | API Hono, IAM (Argon2id, JWT), conexões ERP, Closing Periods |
| `packages/shared` (`@platform/shared`) | Tipos e contratos compartilhados |
| `packages/ui` (`@platform/ui`) | Primitivos shadcn/ui, UI imperativa, DataTable, formulários |
| `packages/web` (`@platform/web`) | SPA Vite + React 19 + Tailwind v4 |

## Como rodar

Requer Node.js >= 24 e pnpm.

```bash
pnpm install
pnpm build         # build de todos os pacotes
pnpm test          # vitest (inclui testes de componente)
pnpm test:e2e      # testes de navegador (Playwright); ver docs/conventions/testing.md
pnpm check:ui      # verifica limites de UI
pnpm dev:server    # API
pnpm dev:web       # SPA
```

## IAM e permissões

Usuário tem um papel; papel tem permissões. Acesso negado por padrão. Convenção de nomes: [docs/conventions/permissions.md](docs/conventions/permissions.md).

## Para agentes

Regras e invariantes: [AGENTS.md](AGENTS.md).
