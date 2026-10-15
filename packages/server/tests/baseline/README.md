# Baseline HTTP

`responses.json` congela `{ status, body }` (e `cookie` quando há Set-Cookie) de cada rota HTTP, gerado por `tests/baseline.test.ts`
com stores em memória, relógio falso (`Date` fixo em 2026-03-10T12:00:00Z) e valores não determinísticos normalizados
(`<token>`, `<uuid>`, `<ts>`).

- Verificar: `pnpm --filter @platform/server test baseline`
- Regenerar (só para mudança de comportamento intencional): `UPDATE_BASELINE=1 pnpm --filter @platform/server test baseline`

## Observações de comportamento congelado

- Todas as rotas, exceto `/api/health` e `/api/auth/*`, exigem token: sem ele respondem 401.
- Workspaces: listar/detalhar exigem `system:workspaces:read`; conclude/reopen exigem só `close`/`reopen`; criar exige também
  `recipe:<id>:view`. Workspace/Modelo/componente/ação desconhecidos: 404. As rotas HTTP de persistência foram removidas.
- Dados e `actions/exec` exigem que a Área de Trabalho exista e seja do Modelo (o id literal `preview` dispensa só em `data`, nunca em `actions/exec`); 400 se for de outro Modelo. Em produção `NODE_ENV` deve ser exatamente `production`.
- A permissão `recipe:<id>:view` é checada antes de resolver o Modelo (403 mesmo para inexistente).
- Schema, dados e `actions/exec` exigem `recipe:<id>:view`; `actions/exec` também a permissão da ação (403 antes de executar).
- Dados sem Área de Trabalho existente (prévia) continuam válidos.
- As mensagens de 403 vêm de `deniedMessage` em `SYSTEM_PERMISSIONS` via `denyMessage(key)`.
- Concessão de acesso (roles/usuários) só do que o chamador possui, medido pelas permissões do token vigente (até 5 min defasado; não revalida no store).
- Não-admin não redefine senha, exclui nem inativa um administrador.
- Auto-exclusão e exclusão/inativação do último administrador ativo: 409.
- Login: mensagem única "Credenciais inválidas."; erros de JWT genéricos; CORS por allowlist (`CORS_ORIGINS`).
- Não existe rota DELETE para roles.

## Pendências conhecidas (não implementadas; módulos futuros)

M1: a `row` enviada pelo cliente em `actions/exec` não é revalidada contra a fonte (módulo recipes). M4: refresh sem rotação/revogação
e logout não invalida tokens (precisa de tokenVersion/denylist no módulo iam). B2: remover permissões de outros roles não é
limitado pelo "só concede o que possui". B3: `updateUser` + `setAdmin` não são atômicos (transação no módulo iam). I1/I3: itens
informativos do revisor ainda em aberto.

## Não exercitado

- Persistência Postgres (`POSTGRES_HOST`), `workspaceStore` e o bloco de boot de `index.ts`: exigem banco; fora do escopo de Memory stores.
- Conexão real MSSQL: o `connectorFactory` é substituído por fakes (a rota `test` é coberta com fake saudável e fake que falha).
