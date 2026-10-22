# Testes

## Componente (jsdom) — `pnpm test`

Vitest roda tudo em um comando. Testes de componente ficam ao lado do código (`*.test.tsx`) e declaram `// @vitest-environment jsdom` na primeira linha. Usam `@testing-library/react` e consultas por papel/rótulo (`getByRole`, `getByLabel`). Cobrem hoje o formulário dinâmico (`DynamicFormFields`) e o host de janelas (`UiProvider`/`WindowHost`).

## Navegador (Playwright) — `pnpm test:e2e`

Pacote `packages/e2e` (`@platform/e2e`). Cobre login, Usuários, Grupos e ERPs em Chromium. Os arquivos são `tests/*.e2e.ts` (extensão própria para o `pnpm test` do Vitest não os pegar).

O Playwright sobe sozinho (`webServer` em `playwright.config.ts`):

- API em `http://localhost:3100` (`packages/e2e/server.ts`): a mesma app Hono com stores em memória e um administrador semeado (`admin.e2e`). Não precisa de Postgres nem Docker. Sempre um processo novo, então os testes são repetíveis.
- SPA (Vite) em `http://localhost:5174`, com o proxy `/api` apontando para a API acima (`API_PROXY_TARGET`).

Primeira vez:

```bash
pnpm install
pnpm -r run build                                   # a API importa @platform/core e @platform/shared via dist
pnpm --filter @platform/e2e run install:browsers    # baixa o Chromium do Playwright
pnpm test:e2e
```

Em Linux sem as bibliotecas do navegador, rode `pnpm --filter @platform/e2e exec playwright install --with-deps chromium`. Depuração: `pnpm --filter @platform/e2e exec playwright test --ui`; o trace de testes que falham fica em `packages/e2e/test-results/`.

Convenção: seletores por papel e rótulo, nunca por classe CSS. O token de acesso vive só em memória (sem `localStorage`), então cada teste faz login pela tela e navega pelo menu em vez de recarregar a página.
