# 10. Módulo `inovafarma_fechamento_mes`

Tamanho: G. Depende de: 03, 09 (e 07 para telas por permissão). É o que o cliente pediu.

## Objetivo

Implementar em código o fluxo de fechamento mensal: lançamento de metas com os parâmetros do cliente,
telas encadeadas (início do mês abre várias telas, cada uma com opções) e o relatório final.

## Estado atual

- Nada implementado. As telas de fechamento existiam como Recipe e foram removidas junto com o
  motor; o cliente atual não tem essas telas no web até este módulo existir.
- Regra de negócio de referência (penalidades, adicionais, comissão final), em git:
  `git show 7a0d847:packages/server/tests/fixtures/fechamento-mes.recipe.ts`.
- Pedidos do cliente anotados em `todo.txt` (raiz): ver 15.

## Passos

1. `defineModule({ id: "inovafarma_fechamento_mes", dependsOn: ["iam","workspaces","inovafarma_connector"] })`.
2. Schema próprio: metas, parâmetros de meta, lançamentos (penalidades/ajustes), com migrations.
3. Permissões `inovafarma_fechamento_mes:meta:create|read|update|approve`, etc.; variantes de tela por
   permissão (ver todos x só os próprios) com `byPermission`.
4. Fluxo "iniciar mês": cria o workspace do período e abre as telas; usar `after` de
   `workspaces.workspace.create` ou ação explícita.
5. Telas no web via `NavEntry` (e variantes), com `useUi` para diálogos e `DataTable`.
6. Relatório final lendo ERP + lançamentos próprios.

## Critério de aceite

- Fluxo completo do mês em ambiente de teste com MSSQL fictício.
- Regras de permissão cobertas com token de não-admin sem `"*"`.

## Dúvidas para responder (negócio; preciso da sua resposta)

- **D6** Quais são as telas do início do mês e o que cada uma faz? ("5 telas, cada uma com opção").
- Como a meta é lançada neste cliente: quais parâmetros (por vendedor, loja, período, categoria)?
- Quem lança, quem aprova, quem só consulta? (mapeia para perfis e permissões)
- O que "fecha" um mês: gerar relatório, travar o workspace, exportar/imprimir?
- Uma meta de outro cliente seria diferente: o módulo deve nascer parametrizável ou fixo para este
  cliente (e copiado para o próximo)?
