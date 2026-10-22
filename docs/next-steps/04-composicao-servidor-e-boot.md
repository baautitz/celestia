# 04. Composição do servidor e boot

Tamanho: G. Depende de: 01, 02, 03. Desbloqueia: 05, 08.

## Objetivo

Reduzir o `index.ts` a uma composição: criar o app, registrar o CORS e carregar os módulos com
`loadModules`. Hoje `createPlatformApp(options)` ainda é um monólito de rotas inline.

## Estado atual

- `createPlatformApp(options)` injeta stores e conectores por opções (usado pelos testes com
  Memory stores). Boot: com `POSTGRES_HOST` usa stores Postgres, senão Memory. Não há migration no
  boot (só `pnpm db:migrate` manual).
- `@platform/core`: `loadModules(app, modules, { registry?, events?, routeMiddleware?, logger? })`
  devolve `{ registry, events, loaded, failed, pruneSafe }`.

## Passos

1. `createPlatformApp({ modules, stores? })`: instancia `PermissionRegistry` e `EventBus`, chama
   `loadModules` e devolve o app; manter injeção de stores para testes.
2. Ordem de boot: variáveis obrigatórias (`JWT_SECRET`) -> conexão -> `assertMigrationsUpToDate`
   (**só verifica, nunca aplica**) -> `loadModules` -> poda de órfãs **só se `pruneSafe`**.
3. Falha ao carregar módulo: log claro com `failed[]`; o servidor sobe com os módulos saudáveis ou
   aborta? (ver dúvida).
4. `withAdminBypass` lê `registry.allKeys()`.
5. Remover o estado de closure que sobrar (`workspacesMap`, etc.).
6. Atualizar `AppType` ou documentar que o RPC tipado do Hono não cobre módulos montados.

## Critério de aceite

- 154 chaves do baseline inalteradas; testes do server verdes.
- Boot com módulo que lança em `register`: servidor sobe (ou aborta, conforme decisão), rotas do
  módulo ausentes, permissões preservadas, `pruneSafe=false`, e nenhuma permissão podada.

## Riscos e cuidados

- Migrations nunca no boot automático (decisão do usuário para a fase atual).
- CORS e `logger` ficam na raiz; o `routeMiddleware` global quebraria `/auth/login`.

## Dúvidas para responder

- Se um módulo **de núcleo** falha (ex.: `iam`), o servidor deve abortar o boot em vez de subir
  parcialmente? Proposta: abortar para módulos marcados como `required`, subir sem os demais.
