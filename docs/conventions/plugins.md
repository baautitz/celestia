# Como criar um Plugin

Um Plugin vive em `integrations/<nome>/` e entra no build do cliente (ADR 0003). O exemplo completo é `integrations/example`.

## Estrutura

```text
integrations/<nome>/
├── package.json          # nome @integrations/<nome>; exports "./server" (dist) e "./web" (src/web.tsx)
├── tsconfig.json         # compila só o lado servidor (src/server.ts e o que ele importa)
├── drizzle/<timestamp>_<descricao>/migration.sql   # migrations do Plugin
└── src/
    ├── permissions.ts    # definePermissions("<id>", { "recurso:acao": ... })
    ├── server.ts         # createXPlugin(deps): ModuleDef via defineModule
    └── web.tsx           # defineWebModule com a tela de menu
```

## Regras

- O `id` do Module aceita só letras minúsculas, números e underscore, começando por letra (`^[a-z][a-z0-9_]*$`); `defineModule` lança caso contrário.
- Um Plugin importa apenas `@platform/core`, `@platform/ui`, bibliotecas de terceiros e arquivos da própria pasta. Importar `@platform/server`, `@platform/web` ou qualquer caminho fora da pasta falha em `pnpm check:plugins`.
- O que o Plugin precisa do servidor (ex.: o middleware de autenticação) entra por injeção: o servidor passa em `createXPlugin({ auth })`.
- Permissions seguem `<id>:<recurso>:<acao>`; rotas ficam em `/api/m/<id>` (ou no `prefix` declarado).

## Entrar ou sair do build

1. Servidor: `packages/server/src/plugins.ts` (`integrationPlugins`) é a lista estática de Plugins. Inclua ou remova a linha do Plugin.
2. Web: `packages/web/src/modules.ts` é a lista estática de telas. Inclua ou remova o módulo web.
3. Dependência: `@integrations/<nome>` em `packages/server/package.json` e `packages/web/package.json` (`workspace:*`), e `pnpm install`.
