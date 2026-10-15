# Celestia

Plataforma corporativa com IAM permission-first: um core pequeno, onde funcionalidades entram como modulos.

O motor de Recipes/SDUI foi removido. Modulos de cliente ficarao em `/integrations` (planejado, ainda nao existe).

## Monorepo

| Pacote | Conteudo |
|---|---|
| `packages/core` (`@platform/core`) | Framework de modulos: contrato, loader, eventos, permissoes |
| `packages/server` (`@platform/server`) | API Hono, IAM (Argon2id, JWT), conexoes ERP, areas de trabalho |
| `packages/shared` (`@platform/shared`) | Tipos e contratos compartilhados |
| `packages/ui` (`@platform/ui`) | Primitivos shadcn/ui, UI imperativa, DataTable, formularios |
| `packages/web` (`@platform/web`) | SPA Vite + React 19 + Tailwind v4 |

## Como rodar

Requer Node.js >= 24 e pnpm.

```bash
pnpm install
pnpm build         # build de todos os pacotes
pnpm test          # vitest
pnpm check:ui      # verifica limites de UI
pnpm dev:server    # API
pnpm dev:web       # SPA
```

## IAM e permissoes

Usuario tem um papel; papel tem permissoes. Acesso negado por padrao. Convencao de nomes: [docs/conventions/permissions.md](docs/conventions/permissions.md).

## Para agentes

Regras e invariantes: [AGENTS.md](AGENTS.md).
