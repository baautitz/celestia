# Baseline HTTP

`responses.json` congela `{ status, body }` (e `cookie` quando há Set-Cookie) de cada rota HTTP, gerado por `tests/baseline.test.ts`
com stores em memória, relógio falso (`Date` fixo em 2026-03-10T12:00:00Z) e valores não determinísticos normalizados
(`<token>`, `<uuid>`, `<ts>`).

- Verificar: `pnpm --filter @platform/server test baseline`
- Regenerar (só para mudança de comportamento intencional): `UPDATE_BASELINE=1 pnpm --filter @platform/server test baseline`

## Observações de comportamento congelado

- Todas as rotas, exceto `/api/health` e `/api/auth/*`, exigem token: sem ele respondem 401.
- Workspaces: listar/detalhar exigem `system:workspaces:read`; gravar persistência exige `system:workspaces:update`;
  conclude/reopen aceitam também o legado `system:workspaces:create`. Workspace/Modelo/componente/ação desconhecidos: 404.
- Schema, dados e `actions/exec` exigem `recipe:<id>:view`; `actions/exec` também a permissão da ação (403 antes de executar).
- Dados sem Área de Trabalho existente (prévia) continuam válidos.
- As mensagens de 403 vêm de `deniedMessage` em `SYSTEM_PERMISSIONS` via `denyMessage(key)`.
- Concessão de acesso (roles/usuários) só do que o chamador possui, medido pelas permissões do token vigente (até 5 min defasado; não revalida no store).
- Não-admin não redefine senha, exclui nem inativa um administrador.
- Pendência documentada: `DELETE /api/iam/users/:id` permite auto-exclusão e exclusão do último administrador.
- Não existe rota DELETE para roles.

## Não exercitado

- Persistência Postgres (`POSTGRES_HOST`), `workspaceStore` e o bloco de boot de `index.ts`: exigem banco; fora do escopo de Memory stores.
- Conexão real MSSQL: o `connectorFactory` é substituído por fakes (a rota `test` é coberta com fake saudável e fake que falha).
