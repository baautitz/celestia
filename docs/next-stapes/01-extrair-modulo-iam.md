# 01. Extrair o módulo `iam`

Tamanho: G. Depende de: 06 (barrel e `mount` do core). Desbloqueia: 02, 03, 04, 07, 13.

## Objetivo

Transformar autenticação, usuários e perfis (roles) em um módulo `iam` construído com
`@platform/core` (`defineModule`), mantendo as URLs públicas (`/api/auth/*`, `/api/iam/*`) e o
baseline HTTP sem mudança de status.

## Estado atual

Tudo está no `packages/server/src/index.ts` (closure de `createPlatformApp`) e em
`packages/server/src/iam/*`:

- `password-service.ts` (Argon2id e política), `token-service.ts` (JWT; segredo; sem `jti`/versão),
  `user-store.ts` (interface + `MemoryUserStore`), `postgres-user-store.ts`, `has-permission.ts`,
  `can-grant.ts`, `middleware.ts` (`createAuthMiddleware`, `requirePermission`,
  `getAuthenticatedUser`), `system-permissions.ts` (só chaves `system:*`).
- Rotas: `/api/auth/{login,refresh,logout,me}`, `/api/iam/{permissions/catalog,sources,users,roles}`.
- Helpers de regra: `grantViolation`, `isLastActiveAdmin`, `ADMIN_TARGET_ONLY`, `WILDCARD_ADMIN_ONLY`,
  `validatePermissionKeys`, `withAdminBypass`.
- Banco: tabelas `users` e `roles` em `src/db/schema.ts`; CLI `src/cli/create-admin.ts`.
- `GET /api/iam/sources` lê `connectionStore` (acoplamento com connections).

## Passos (commits pequenos; baseline e testes verdes a cada um)

1. Pré-requisito: tarefa 06 (barrel do core, opção `mount`, `allKeys()`/`catalog()` no contexto).
2. Criar `packages/server/src/modules/iam/` com `defineModule` vazio e ligá-lo sem mudar nada.
3. `git mv` dos arquivos puros (password, token, has-permission, can-grant, middleware, stores);
   deixar re-exports nos caminhos antigos até o fim.
4. Trocar `syncOrphanPermissions` por `pruneRolePermissions(validKeys)` (já usa `pruneOrphans` do core).
5. Declarar `definePermissions("system", { "users:create": {...}, ... })` com `deniedMessage`
   idêntico ao texto atual; o `PermissionRegistry` vira a fonte de `allKeys()` (bypass de admin e
   validação de chaves de role).
6. Mover as rotas `/api/auth/*` com `mount: "/api"`; expor serviços (`auth`, `requirePermission`,
   `hasPermission`, `canGrant`, `userStore`, `tokenService`).
7. Mover as rotas `/api/iam/*`; `sources` recebe a lista por injeção (ver 02).
8. Emitir eventos `iam.user.create|update|delete|password_reset|login`, `iam.role.create|update`
   com `ctx.events.run` (payload sem `passwordHash`).
9. Banco: `pgSchema('iam')`, `drizzle.config.ts` do módulo, migration regenerada (tarefa 05).
10. Segurança: B3 e M4 (ver 13 e abaixo). Remover os re-exports e atualizar `AGENTS.md` §2.

## Itens de segurança que entram aqui

- **B3**: `updateUser` e `setAdmin` hoje são duas operações. Passar `isAdmin` para dentro de
  `updateUser` (um `UPDATE`) e usar transação para "último admin" e para o `create-admin`.
- **M4**: `tokenVersion` na tabela `iam.users`, `tv` nos payloads de access e refresh; incrementar em
  logout, reset de senha, inativação, exclusão e troca de role; o refresh recusa versão antiga. O
  access de 5 min continua stateless (staleness documentada).

## Critério de aceite

- `pnpm --filter @platform/server test` verde; as 154 chaves do baseline sem mudança de status
  (exceto refresh/logout se M4 mudar corpos, e então por diff revisado).
- URLs públicas iguais; o web não muda.
- Teste com Postgres real passou ao menos uma vez (tarefa 11).
- `grep` por `permissions.includes` no servidor segue vazio.

## Riscos e cuidados

- `routeMiddleware` global do loader aplicaria auth a `/auth/login`: não usar no `iam`; aplicar
  `auth` por rota.
- `guard` e `requirePermission` devolvem corpos 403 diferentes e o baseline fixa ambos.
- `create-admin` snapshota `SYSTEM_PERMISSIONS` no role admin: usar `registry.allKeys()`.
- `AppType` (RPC tipado do Hono) perde inferência em sub-apps montados; o web usa `fetch` manual.

## Dúvidas para responder

- **D2** Módulos de núcleo em `packages/server/src/modules/<id>` (assumido; não confirmado)?
- O módulo se chama `iam` e as permissões ficam em `system:*`: mantém assim (ver `docs/conventions`)?
