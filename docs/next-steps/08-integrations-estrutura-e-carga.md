# 08. `/integrations`: estrutura e carga

Tamanho: M. Depende de: 04. Desbloqueia: 09, 10.

## Objetivo

Definir como um módulo de cliente (backend, frontend e migrations juntos) vive em `/integrations` e
é carregado pelo servidor e pelo web, sem loja nem ativação em runtime.

## Estado atual

- Não existe `/integrations`. `pnpm-workspace.yaml` cobre só `packages/*`.
- Servidor: `loadModules` aceita uma lista de `ModuleDef`; ninguém a monta ainda.
- Web: `packages/web/src/modules.ts` é uma lista estática com `coreModule`.

## Proposta

```text
integrations/
  inovafarma_connector/
    package.json            (@integrations/inovafarma_connector; depende de @platform/core e @platform/ui)
    src/server/index.ts     (export default defineModule({...}))
    src/web/index.ts        (export default defineWebModule({...}))
    migrations/             (drizzle do módulo)
```

1. `pnpm-workspace.yaml` ganha `integrations/*`.
2. Servidor: `packages/server/src/modules.ts` importa cada módulo explicitamente (lista estática,
   tipada, sem varredura de pasta).
3. Web: `packages/web/src/modules.ts` idem.
4. Cada módulo importa **só** `@platform/core` (servidor) e `@platform/ui` (web); nunca arquivos do
   `packages/server` ou `packages/web`.
5. Um script `check:modules` (como `check:ui`) que falha se um módulo importar fora dessas fronteiras.
6. README de "como criar um módulo" com o exemplo mínimo.

## Critério de aceite

- Um módulo de exemplo (`hello`) com uma rota, uma permissão, uma migration e uma tela no menu sobe
  e some mudando só a lista estática.

## Riscos e cuidados

- **Id de módulo não aceita hífen** (`^[a-z][a-z0-9_]*$`, para virar schema Postgres e prefixo de
  chave): use `inovafarma_connector`, não `inovafarma-connector`. O nome do pacote pode ter hífen;
  o `moduleId` não.
- Módulos pré-compilados e distribuídos ficam fora de escopo (decisão anterior: só quando houver
  loja ou segundo cliente).

## Dúvidas para responder

- **D3** Lista estática nos dois lados é o bastante ou prefere descoberta por convenção de pasta
  (`import.meta.glob` no web, varredura no servidor)? Proposta: estática.
- **D4** Confirma o uso de underscore nos ids (`inovafarma_connector`)?
- Os módulos de cliente ficam neste repositório ou em um repositório separado que importa o core?
