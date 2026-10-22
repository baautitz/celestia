# 03. Módulo `workspaces`

Tamanho: M. Depende de: 01. Desbloqueia: 04, 10.

## Objetivo

O Período de Fechamento é um **Plugin** (não faz parte do sistema base). Um Plugin que dependa dele
traz o módulo para o build do cliente.

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

7. Invariante de não sobreposição (hoje inexistente): uma data pertence a no máximo um período,
   esteja ele aberto ou concluído; só **cancelar** o período libera as datas (ver glossário); criar ou editar um período que toque outro é rejeitado (400).
   Os períodos podem ter qualquer duração (não só mensal).
   Um período **aberto** pode ter a faixa ampliada ou reduzida (ex.: 01/08 a 30/08 corrigido para
   01/08 a 31/08), desde que os dias adicionados não estejam em outro período não cancelado. Período
   concluído não tem a faixa editada: é preciso reabri-lo antes.
8. Renomear Workspace / Área de Trabalho para **Período de Fechamento** (`ClosingPeriod`), conforme
   `packages/server/GLOSSARY.md`: tabela, rotas, permissões `system:*`, tipos em `shared`, `AGENTS.md`.

9. Cancelar = remover a linha (`DELETE /api/workspaces/:id` vira o cancelamento; não existe status
   "cancelado"). O evento `before` de cancelamento deixa módulos de negócio vetarem quando há dados
   que dependem do período. Só se cancela um período **aberto**; o concluído é reaberto antes (padrão
   adotado, ainda não confirmado).
10. Auditoria por período: um **log global**, com um registro por evento do período (criar, editar
   faixa, concluir, reabrir, cancelar). Os atributos serão especificados depois; o log ainda não
   existe e a tarefa 15 (auditoria) é o lugar natural dele.

## Critério de aceite

- Chaves `ws.*` do baseline sem mudança de status.
- Datas inválidas continuam 400 com a mensagem `"A Data Final não pode ser anterior à Data Inicial."`.
- Trava de workspace concluído coberta por teste de não-admin.
- Períodos com datas em comum (abertos ou concluídos) são rejeitados, coberto por teste.

## Dúvidas para responder

- **D7** Workspaces precisa de telas no web (lista, criar, concluir, reabrir)? Onde ficam no menu e
  com qual rótulo? (Terminologia do `AGENTS.md`: "Área de Trabalho".)
- Um workspace pertence a um módulo (ex.: fechamento) ou é genérico para todos? Hoje é genérico.
- Controle de versão otimista entra aqui ou só quando houver edição concorrente real?
