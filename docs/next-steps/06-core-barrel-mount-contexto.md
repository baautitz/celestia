# 06. Core: barrel, `mount` e contexto de permissões

Tamanho: P. Depende de: nenhuma. Desbloqueia: 01.

## Objetivo

Fechar as três lacunas do `@platform/core` que a extração do `iam` precisa.

## Estado atual (`packages/core/src`)

- `permissions.ts`, `events.ts`, `graph.ts`, `migrations.ts`, `module.ts`, `loader.ts` com testes.
- `index.ts` ainda é `export {}`; os consumidores importam por subcaminho (`@platform/core/permissions`).
- O loader monta sempre em `/api/m/<id>`; não há como manter `/api/auth` e `/api/iam`.
- `ModuleContext.permissions` só tem `registerProvider` e `has`; falta `allKeys()` e `catalog()`.
- `package.json` `exports` não tem a entrada `./graph` (migrations importa relativo).

## Passos

1. Barrel `index.ts` reexportando permissões, eventos, módulo, loader, migrations e grafo.
2. `ModuleDef.mount?: string` (padrão `/api/m/<id>`); o loader monta o sub-app no prefixo pedido;
   validar colisões de prefixo entre módulos (erro claro no boot).
3. `ctx.permissions.allKeys()` e `ctx.permissions.catalog()`.
4. Entrada `./graph` em `exports`, no padrão `types`/`default` apontando para `dist`.
5. Renomear o módulo arbitrário `"recipe"` usado em `permissions.test.ts` (resto do vocabulário antigo).
6. Testes: montagem em `/api` com `app.request`, colisão de prefixo, catálogo agregado.

## Critério de aceite

- `pnpm --filter @platform/core test` verde; nenhum teste usa a palavra "recipe".
- O `server` compila contra `dist` (`tsc -b`), como o `shared`.

## Riscos e cuidados

- Mudança de contrato do `ModuleDef`: nada em produção o usa ainda, então é barato agora e caro depois.

## Dúvidas para responder

- `mount` opcional por módulo mantém a convenção uniforme `/api/m/<id>` para módulos novos e abre
  exceção só para o núcleo. Aceitável, ou prefere reescrever o web e o baseline para
  `/api/m/<id>/...` de uma vez? (Decidido: manter URLs estáveis; registrado aqui para reavaliar.)
