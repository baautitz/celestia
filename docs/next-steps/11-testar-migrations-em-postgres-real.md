# 11. Testar migrations em Postgres real

Tamanho: P. Depende de: 06 (e útil para validar 01 e 05).

## Objetivo

Provar, ao menos uma vez e depois em rotina, que o runner de migrations por módulo e os stores
Postgres funcionam contra um Postgres real. Hoje **nada foi executado contra um banco real**.

## Estado atual

- `packages/core/src/migrations.test.ts` tem 5 testes; 4 rodam com um `db` falso e 1 está
  **skipped**: só roda com `POSTGRES_HOST` **e** `MIGRATIONS_TEST_DB=1` (trava dupla para nunca tocar
  um banco que não seja descartável). Ele cria um schema `t4_<timestamp>` e o remove no `finally`.
- Os stores `PostgresUserStore`, de conexões e de workspaces não têm teste de integração.
- No ambiente de desenvolvimento há `docker` (cliente) e `podman`; não há servidor Postgres local.

## Passos

1. Script `pnpm test:db` que sobe um Postgres descartável (por exemplo
   `podman run --rm -e POSTGRES_PASSWORD=... -p 55432:5432 postgres:17`), exporta as variáveis,
   roda os testes opt-in e derruba o container.
2. Testes de integração dos stores Postgres (usuários, perfis, conexões, workspaces) com dados
   sintéticos, reaproveitando o baseline HTTP com stores reais quando possível.
3. Teste do `assertMigrationsUpToDate` (pendente, em dia, módulo sem migrations).
4. Documentar no README do servidor.

## Critério de aceite

- `pnpm test:db` verde localmente; o teste opt-in deixa de ser "skipped" nesse modo.

## Riscos e cuidados

- Agentes **nunca** apontam para o banco do cliente; só Postgres local descartável.

## Dúvidas para responder

- Prefere `docker` ou `podman`? Há CI onde isso deveria rodar? (Hoje não há pipeline no repositório.)
