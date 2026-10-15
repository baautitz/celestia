# Baseline HTTP

`responses.json` congela `{ status, body }` (e `cookie` quando há Set-Cookie) de cada rota HTTP, gerado por `tests/baseline.test.ts`
com stores em memória, relógio falso (`Date` fixo em 2026-03-10T12:00:00Z) e valores não determinísticos normalizados
(`<token>`, `<uuid>`, `<ts>`).

- Verificar: `pnpm --filter @platform/server test baseline`
- Regenerar (só para mudança de comportamento intencional): `UPDATE_BASELINE=1 pnpm --filter @platform/server test baseline`

## Observações de comportamento congelado

- `/api/workspaces*`, `/api/recipes`, `/api/lookups`, `/api/dashboards/:id/schema`, dados e `actions/exec` usam auth opcional:
  sem token respondem 200 (não há 401); o 403 só ocorre com token sem a permissão.
- `/api/workspaces/:id/persistence/*` não têm nenhuma autenticação.
- `/api/dashboards/:id/schema` de Modelo inexistente responde 500 (exceção não tratada).
- `GET /api/workspaces/:id` desconhecido devolve um workspace padrão; `conclude`/`reopen` de id desconhecido criam o workspace.
- Não existe rota DELETE para roles.

## Não exercitado

- Persistência Postgres (`POSTGRES_HOST`), `workspaceStore` e o bloco de boot de `index.ts`: exigem banco; fora do escopo de Memory stores.
- Conexão real MSSQL: o `connectorFactory` é substituído por fakes (a rota `test` é coberta com fake saudável e fake que falha).
