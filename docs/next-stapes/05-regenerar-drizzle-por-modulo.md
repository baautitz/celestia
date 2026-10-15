# 05. Regenerar `drizzle/` por módulo

Tamanho: M. Depende de: 01, 02, 03. Desbloqueia: 11.

## Objetivo

Uma pasta de migrations e um schema Postgres por módulo, geradas do zero (sem compatibilidade: o
banco será reconstruído).

## Estado atual

- `packages/server/drizzle/` com 7 migrations antigas mais `20261015040327_drop_recipes_and_persistence`.
- Schema único em `packages/server/src/db/schema.ts` (tabelas `users`, `roles`, `connections`,
  `workspaces`, todas em `public`).
- `db:generate` (`drizzle-kit generate`) e `db:migrate` (`tsx src/db/migrate.ts`) únicos.
- Runner por módulo já existe em `@platform/core/migrations`: `planMigrations`, `runModuleMigrations`,
  `assertMigrationsUpToDate`; tabela de controle `drizzle.__migrations_<id>`; schema do módulo =
  `moduleId`; ids e schemas validados por `^[a-z][a-z0-9_]*$`.
- drizzle-orm `1.0.0-rc.4`: `migrate()` retorna `void` e decide pendência por **nome** da migration.

## Passos

1. Para cada módulo: `src/schema.ts` com `pgSchema('<id>')`, `drizzle.config.ts` com `out` próprio e
   `schemaFilter: ['<id>']`.
2. Apagar `packages/server/drizzle/` antigo e `src/db/schema.ts` único.
3. `pnpm ... db:generate --name=init_<modulo>` por módulo (§22 do `AGENTS.md`: nome descritivo).
4. Script `db:migrate` que monta o plano com `planMigrations` e roda `runModuleMigrations`.
5. FK entre módulos (ex.: algo -> `iam.users`) com referência qualificada por schema, e só quando o
   módulo declarar `dependsOn` do `iam`.
6. Documentar o fluxo no README do servidor.

## Critério de aceite

- `db:migrate` num Postgres vazio cria `iam.*`, `connections.*`, `workspaces.*` e as tabelas
  `drizzle.__migrations_<id>`; rodar de novo não faz nada.
- `assertMigrationsUpToDate` falha com mensagem clara (módulo e migration) quando há pendência.

## Dúvidas para responder

- **D8** Seeds: quais perfis (roles) iniciais existem com o banco reconstruído e quem é o primeiro
  admin? Hoje só o CLI `create-admin` cria o role `admin` com todas as chaves.
- Tabelas de controle ficam em `drizzle.*` (padrão do migrator) ou no schema de cada módulo?
  Assumido `drizzle.*`.
- Lock consultivo (`pg_advisory_lock`) no `runModuleMigrations`, para duas instâncias não migrarem ao
  mesmo tempo? Hoje há uma janela teórica entre ler pendentes e aplicar.
