# 14. Qualidade e arrumação

Tamanho: M. Depende de: nenhuma (itens independentes).

## 1. Bug latente: Hooks dentro de `map`/`switch` no `DynamicFormFields` (prioridade alta)

`packages/ui/src/forms/DynamicFormFields.tsx` chama `useFieldOptions(field, ...)` e
`useComboboxAnchor()` **dentro** do `fields.map(...)` e do `switch (field.type)` (por volta das
linhas 276 a 318). Isso viola as regras de Hooks do React: mudar a lista de campos ou o tipo de um
campo muda a ordem dos Hooks e pode quebrar a renderização. O código veio do web e foi movido para a
lib sem correção. A auditoria externa já apontava (item 11 em 15).

Correção: um componente por tipo de campo (`SelectField`, `LookupSelectField`, `ComboboxField`, ...),
cada um com os Hooks no topo; `DynamicFormFields` só decide qual renderizar. Sem mudar markup nem
classes (comparação por DOM contra o estado atual).

## 2. Lint

`packages/web/eslint.config.js` existe, mas não há script `lint` em nenhum `package.json`. Ligar
`eslint` (instalar a dependência que faltar), incluindo `eslint-plugin-react-hooks`, que pegaria o
item 1. Adicionar ao `pnpm -r run` e ao fluxo de commit.

## 3. Testes de componentes e de navegador

Não há `jsdom` nem testing-library; só a lógica pura é testada (controller, formatação, loader).
A fidelidade visual foi validada por DOM com Playwright fora do repositório. Trazer para o repositório:
Vitest com `jsdom` para os componentes críticos (formulário dinâmico, host de janelas) e Playwright
para os fluxos de login, usuários, perfis e ERPs.

## 4. Arrumação

- Os registros históricos de Recipes/SDUI (`component_registry`, `implementation_plan`, `session-summary-layout-rules`) foram apagados; recuperáveis pelo histórico do git.
- `todo.txt` migrado para `docs/ideas/wishlist.md`.
- `engines` do `packages/server` ainda exige Node >= 24 por causa do `isolated-vm`, já removido:
  baixar o piso depois de testar em outra versão (hoje o ambiente roda Node 24).
- **Permissões declaradas sem uso** (verificado por `grep` em server, web e ui):
  `system:roles:delete` (não existe rota `DELETE /api/iam/roles/:id`) e `system:audit:read` (não existe
  nenhuma rota de auditoria). Aparecem como opção na tela de perfis sem fazer nada. Remover do
  catálogo ou implementar a funcionalidade (decisão sua: D15 abaixo).
- `MockSourceConnector` (`data/source-connector.ts`, linhas ~70 a 76) ainda tem heurísticas de
  InovaFarma no SQL (`e.id =`, `v.id =`, `vendedor_id =`, `inovafarma`): mover para a fixture do teste.
- `Atualizado em` da lista de ERPs depende do relógio no baseline visual: fixar a data no harness.
- Bundle do web em torno de 800 kB: dividir por rotas (`React.lazy`) quando houver mais módulos.

## 5. Processo

`AGENTS.md` §12 manda pedir confirmação do usuário a cada passo, o que conflita com o modo de
trabalho com agentes autônomos que usamos. Hoje vale o acordo desta sessão (o usuário autoriza lotes e
os gates), mas o texto do arquivo precisa dizer isso.

## Dúvidas para responder

- **D12** Reescrever o §12 do `AGENTS.md` para refletir o acordo atual (lotes autorizados + gate de QA)?
- **D13** Tema escuro: manter light-only (decisão atual) ou ativar de verdade (montar `ThemeProvider`,
  alternador e novo baseline)? Os tokens `.dark` existem no CSS.
- Prioridade do item 1 em relação às demais tarefas: antes ou depois do módulo `iam`?
- **D15** `system:roles:delete` e `system:audit:read`: remover do catálogo agora, ou implementar
  (excluir perfil; trilha de auditoria)? Excluir perfil exigiria decidir o que acontece com os
  usuários daquele perfil.
