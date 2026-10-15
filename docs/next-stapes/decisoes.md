# Decisões já tomadas

Registro das decisões do usuário durante a refatoração, para não serem reabertas por engano.

## Produto e arquitetura

- O Celestia deixou de ser "motor de Recipes". Passa a ser **core pequeno + módulos**, cada módulo
  um bounded context. Módulos de cliente ficarão em `/integrations`.
- **Não há mais Recipes.** O motor (compilador esbuild, sandbox `isolated-vm`, `ActionExecutor`,
  `DataResolver`, stores e rotas de recipes/dashboards/data/actions, permissões `recipe:*`) foi
  removido por completo, não extraído. Fixture antiga do fechamento, para consulta de regra de
  negócio: `git show 7a0d847:packages/server/tests/fixtures/fechamento-mes.recipe.ts`.
- **Workspace (Área de Trabalho) não é do core**: será implementado por um módulo próprio
  `workspaces`, sem `recipe_id`, com a invariante de datas (`end_date >= start_date`).
- **`persistence_items` saiu**: cada módulo guarda os próprios dados no próprio schema.
- Sem loja e sem ativar/desativar módulos por enquanto; módulos entram no build.
- **Sem clientes e sem compatibilidade**: o banco será reconstruído; regenerar migrations do zero.

## Comunicação entre módulos

- Por eventos: `before` (cancelável, só valida, nunca grava, falha fechada em timeout ou erro) e
  `after` (pós-ação, falha isolada). Ou por serviço exposto, só para módulos em `dependsOn`.
- `dependsOn` é acíclico; ciclo ou dependência desconhecida derruba o boot sem montar nada.
- Um módulo que falha ao carregar desfaz seus handlers de evento, não monta rotas, mantém as
  permissões no registro e marca `pruneSafe: false` (para não podar permissões dos perfis).

## Permissões

- Chave `<modulo>:<recurso>:<verbo>`; o core usa o prefixo `system:`. Convenção de verbos em
  [docs/conventions/permissions.md](../conventions/permissions.md) (orientação, sem lint).
- Declaração com `definePermissions` + `guarded(perm, fn)` e `byPermission([{ when, run }])`.
  **Sem decorators** (só funcionam em métodos de classe).
- Ausência, string vazia ou lista inválida de permissão **nega** (fail-closed), inclusive na
  declaração do wrapper.
- `deniedMessage` em PT-BR declarado junto da permissão.
- O curinga `"*"` é honrado em todas as rotas e **preservado** pela poda de órfãs. Só administrador
  (`isAdmin`) concede ou remove `"*"`.
- Regra "só concede o que possui": um não-admin só atribui role (ou grava chaves em role) cujas
  permissões sejam subconjunto das dele. Admin é isento.
- Só admin age sobre admin: redefinir senha, alterar campos, excluir, inativar. Não se exclui a si
  mesmo nem o último admin ativo (409).

## Servidor (hardening)

- Autenticação obrigatória em todas as rotas, exceto `health`, `login`, `refresh` e `logout`.
- Recurso desconhecido responde 404; `preview` vale só para leitura de dados (hoje sem uso).
- `JWT_SECRET` obrigatório em produção, com 32+ caracteres; fora de produção, segredo efêmero.
- CORS por allowlist (`CORS_ORIGINS`, padrão `http://localhost:5173`); cookie `access_token` removido.
- Login: mensagem única "Credenciais inválidas." e hash dummy para igualar tempo.
- Ids com `randomUUID` (`usr_<uuid>`, `ws_<uuid>`).

## Web e UI

- Design system intocável (shadcn `base-lyra` sobre Base UI, Inter, `--radius: 0`, lucide).
- App é **light-only**: o `ThemeProvider` nunca foi montado no original; não montar.
- UI imperativa por `useUi()` (`windows.open`, `windows.confirm`, `feedback`), sem hotkeys nem
  navegação por teclado customizados. `restoreFocus` existe no controller.
- Registro de módulos no web por lista estática (`modules.ts`); `/` redireciona para a primeira
  entrada acessível.
- Formulários: `Form*` com zod, mensagens abaixo do campo, sem validação nativa (`noValidate`).
- Lib define os tipos de campo e o `shared` reexporta com `export type *` (inversão conhecida; ver 12).

## Git e processo

- Commits one-line conventional, granulares. Merge na `main` e push só por ordem explícita.
- Agentes trabalham em worktrees e branches próprias; só o Tech Lead mergeia; gate de QA antes.
- Nunca apontar um agente para um banco que não seja local e descartável.
- QA por DOM e medidas (o usuário recusou a leitura de imagens de diff).
