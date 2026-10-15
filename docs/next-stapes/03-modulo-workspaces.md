# 03. Módulo `workspaces`

Tamanho: M. Depende de: 01. Desbloqueia: 04, 10.

## Objetivo

Implementar Área de Trabalho (período de fechamento) como módulo próprio, sem `recipe_id`, com a
invariante de datas, para os módulos de negócio dependerem dele por `dependsOn`.

## Estado atual

- Já sem `recipe_id` nem `params` (removidos na limpeza de recipes).
- Em `packages/server/src/index.ts`: `GET/POST /api/workspaces`, `GET/PUT/DELETE /api/workspaces/:id`,
  `POST .../conclude` e `POST .../reopen`. Validação com `IsoDateSchema` (YYYY-MM-DD estrito, data
  real) e regra `end_date >= start_date`; 404 para id desconhecido.
- `data/workspace-store.ts` e `postgres-workspace-store.ts`; tabela `workspaces`.
- `engine/workspace-validator.ts`.
- Permissões: `system:workspaces:create|read|update|delete|close|reopen`, `deniedMessage` declarados.
- O web não tem telas de workspace (removidas junto com o SDUI).

## Passos

1. `defineModule({ id: "workspaces", dependsOn: ["iam"] })`, `mount: "/api"`.
2. Mover rotas, stores e validador; permissões por `definePermissions` com os mesmos textos.
3. Eventos `workspaces.workspace.create|update|delete|close|reopen`, com `before` cancelável. Caso
   de uso: o módulo de fechamento vetar a reabertura de um período com pendências.
4. Expor serviço `workspaces.get(id)` e `workspaces.assertOpen(id)` (trava de "concluído").
5. `pgSchema('workspaces')` e migration regenerada (05).
6. Controle de versão otimista (hoje inexistente): coluna `version`, `If-Match`/campo `version`,
   409 em conflito (item 9 da auditoria externa; ver 15).

## Critério de aceite

- Chaves `ws.*` do baseline sem mudança de status.
- Datas inválidas continuam 400 com a mensagem `"A Data Final não pode ser anterior à Data Inicial."`.
- Trava de workspace concluído coberta por teste de não-admin.

## Dúvidas para responder

- **D7** Workspaces precisa de telas no web (lista, criar, concluir, reabrir)? Onde ficam no menu e
  com qual rótulo? (Terminologia do `AGENTS.md`: "Área de Trabalho".)
- Um workspace pertence a um módulo (ex.: fechamento) ou é genérico para todos? Hoje é genérico.
- Controle de versão otimista entra aqui ou só quando houver edição concorrente real?
