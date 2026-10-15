# 09. Módulo `inovafarma_connector`

Tamanho: G. Depende de: 02, 08. Desbloqueia: 10.

## Objetivo

Conector de leitura para o ERP InovaFarma, mais a responsabilidade de associar um usuário do
Celestia ao seu identificador no ERP (hoje `users.externals`, genérico demais para o core).

## Estado atual

- `SourceConnector` genérico e `MssqlSourceConnector` em `packages/server/src/data`.
- "InovaFarma" é só um id de conexão por convenção; não há classe nem módulo.
- `users.externals` (jsonb) está na tabela `users` do core, no JWT e nas rotas de usuário
  (`ExternalsMap` em `@platform/shared/types/iam.ts`).
- A fixture antiga mostra o uso: `{{user.externals.inovafarma}}` em
  `git show 7a0d847:packages/server/tests/fixtures/fechamento-mes.recipe.ts`.

## Passos

1. `defineModule({ id: "inovafarma_connector", dependsOn: ["connections"] })` em `/integrations`.
2. Registrar um tipo de ERP `inovafarma` (campos de conexão) via serviço do módulo `connections`.
3. Serviço exposto `inovafarma.query(sql, params)` com o `read-only-guard` e bind params
   (`template-engine`), sem string concatenada (`AGENTS.md` §6).
4. Mapeamento usuário -> id no ERP em tabela própria (`inovafarma_connector.user_links`) e telas de
   gestão (slot no formulário de usuário, ou tela própria).
5. Remover `externals` do core: coluna, token, DTOs, rotas e o campo da `IAMUsersPage` (a seção
   "Identificadores nos ERPs" vira slot de módulo).
6. Testes com `MockSourceConnector`; opt-in com MSSQL de teste.

## Critério de aceite

- Nenhuma menção a InovaFarma no core, no `iam` ou em `connections`.
- Consulta com id do usuário passa por bind param; teste de injeção.

## Dúvidas para responder

- **D5** Destino de `users.externals`: tabela do módulo (proposto), ou um mecanismo genérico de
  "atributos do usuário" no `iam` que qualquer módulo possa preencher?
- Quais tabelas/colunas do InovaFarma o módulo precisa expor? (vendas, vendedores, metas, ...)
- Um usuário pode ter mais de um id de ERP (várias empresas/filiais)?
- Credenciais do ERP de produção: quem fornece e como entram (`CONNECTIONS_ENCRYPTION_KEY`)?
