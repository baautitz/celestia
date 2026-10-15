# 02. Módulo `connections`

Tamanho: M. Depende de: 01. Desbloqueia: 04, 09.

## Objetivo

Isolar conexões de ERP e conectores de fonte num módulo próprio, para o `inovafarma_connector` (09)
depender dele por `dependsOn` e consumir um serviço, sem importar arquivos do servidor.

## Estado atual (em `packages/server/src`)

- `data/source-connector.ts`: interface `SourceConnector` (`query(sql, params?)`, `healthCheck?`,
  `close?`) e `MockSourceConnector`; `resolveSourceConnector`.
- `data/mssql-source-connector.ts`: único conector real.
- `data/erp-types.ts`: `ERP_TYPES = { mssql }`, com `fields` (FormFieldDef) e `createConnector`.
- `data/connection-factory.ts`, `connection-store.ts`, `postgres-connection-store.ts`,
  `secret-box.ts` (criptografia de segredos), `read-only-guard.ts`.
- Rotas `/api/admin/connections*` e `/api/admin/erp-types`; permissão `system:sources:manage`.
- `engine/template-engine.ts`: SQL com bind params (`@p1`); fica disponível para os conectores.
- CLI `src/cli/erp-query.ts` (ERP-specific).
- Tabela `connections` (`config` jsonb, `secrets_encrypted`).

## Passos

1. `defineModule({ id: "connections", ... })` em `modules/connections`, `mount: "/api"` (URLs iguais).
2. Mover stores, factory, `secret-box`, `read-only-guard`, `erp-types` e conectores.
3. Expor serviços: `connectors.get(id)`, `connectors.list()`, `registerErpType(def)` (para o módulo
   InovaFarma registrar o seu tipo sem editar o core).
4. `GET /api/iam/sources` (no iam) passa a consumir `connections.list()` (injeção temporária no 01).
5. Eventos `connections.connection.save|delete` (before/after) para outros módulos reagirem.
6. `pgSchema('connections')` e migration regenerada (05). Hot-swap de conector no `PUT` preservado.

## Critério de aceite

- Chaves `admin.connections.*` e `admin.erp_types.*` do baseline inalteradas.
- Teste do `MockSourceConnector` sem heurísticas de InovaFarma no SQL (hoje há vazamento:
  casa por `e.id =`, `v.id =`, `vendedor_id =` e `inovafarma`); mover isso para a fixture do teste.
- Nenhum segredo em log ou resposta (`secretsEncrypted` omitido, §8 do AGENTS.md).

## Riscos e cuidados

- `CONNECTIONS_ENCRYPTION_KEY` é exigida ao salvar ERP; documentar no README do módulo.
- Registrar tipos de ERP por serviço muda `ERP_TYPES` de constante para registro mutável: manter
  imutável após o boot.

## Dúvidas para responder

- O tipo `mssql` fica no módulo `connections` ou vai para o `inovafarma_connector`? (Hoje é o único.)
- `erp-query` (CLI) continua útil? Mantém, move para o módulo ou remove?
