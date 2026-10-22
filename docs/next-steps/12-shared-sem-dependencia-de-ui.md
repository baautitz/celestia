# 12. `shared` sem depender de `ui`

Tamanho: P. Depende de: nenhuma.

## Objetivo

Remover a dependência invertida: `@platform/shared` reexporta tipos de campo de `@platform/ui`,
que é um pacote com React. O servidor, que consome `shared`, passa a depender do pacote de UI
(só por tipos, mas depende).

## Estado atual

- `packages/shared/src/types/fields.ts` contém `export type * from "@platform/ui/contracts/fields";`.
- `packages/shared/package.json` tem `"@platform/ui": "workspace:*"`.
- O `export type *` é obrigatório: com `export *` o `dist` do shared emitiria um `require` de um
  arquivo `.ts` e quebraria o servidor em runtime.
- Os tipos de campo (`FormFieldDef`, `FieldType`, `LookupConfig`, ...) são usados pelo servidor em
  `erp-types.ts` e pelo web/ui nos formulários.

## Passos

1. Criar um pacote folha **sem React e sem Hono** (por exemplo `@platform/contracts`) com os
   contratos de campo e, depois, o contrato de permissão e `pickVariant`/`resolveComponent` (07).
2. `ui` e `shared` (e `server`) dependem dele; remover `@platform/ui` das dependências do `shared`.
3. Atualizar imports; `export type *` deixa de ser necessário.
4. Manter `@platform/shared` só com o que for realmente compartilhado (IAM, workspace, ERP).

## Critério de aceite

- `grep "@platform/ui" packages/shared packages/server` vazio.
- Builds de shared, core, server e web e `check:ui` verdes.

## Dúvidas para responder

- Vale um pacote novo, ou os contratos de campo moram em `shared` e o `ui` passa a depender de
  `shared` (sentido natural, como era antes de eu invertê-lo)? A inversão foi escolha minha do passo 1
  por querer a UI dona do contrato; reavalie.
