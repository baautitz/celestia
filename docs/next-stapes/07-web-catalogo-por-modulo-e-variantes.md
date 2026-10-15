# 07. Web: catálogo por módulo e telas por permissão

Tamanho: M. Depende de: 01. Desbloqueia: 10.

## Objetivo

1. A tela de Perfis (Roles) lista as permissões **por módulo**, a partir do catálogo agregado.
2. Uma entrada de menu pode ter **variantes de componente por permissão** (primeira que casa vence),
   que é a ideia de "a tela pode ser de um jeito ou de outro" da lista de desejos.

## Estado atual

- `GET /api/iam/permissions/catalog` devolve `{ system: Record<modulo, PermissionItem[]> }`.
- `IAMRolesPage` renderiza `catalog.system` por nome de módulo (grupo "Módulos de Sistema").
- `packages/ui/src/contracts/module.ts`: `NavEntry { id, label, icon, path, group, permission, title?,
  component }` e `WebModule { id, entries }`. Uma permissão e um componente por entrada.
- `App.tsx` gera rotas de `allEntries` com `ProtectedRoute requiredPermission` (uma string);
  `AppLayout` filtra o menu por `accessibleEntries(hasPermission)`; `AuthContext` já tem
  `hasAnyPermission`.

## Passos

1. Catálogo: `{ modules: [{ id, name, items }] }` (mantendo `system` por compatibilidade interna até
   o web migrar); `IAMRolesPage` itera `modules`.
2. `NavEntry.variants?: { permission; component }[]`; `component` vira o padrão/fallback.
3. Função pura `resolveComponent(entry, hasPermission)` em `packages/ui/src/contracts`, com teste
   Node (não há jsdom). `pickVariant` do core é a mesma lógica: **não importar `@platform/core` no
   web** (ele depende de `hono`); mover a função pura para um pacote folha (ver 12).
4. Visibilidade da entrada: permissão própria **ou** qualquer permissão de variante.
5. `ProtectedRoute` aceita lista (`any of`).
6. Validar fidelidade visual por DOM: nada pode mudar nas telas atuais.

## Critério de aceite

- Roles lista os módulos sem mudar o layout atual (comparação por DOM).
- Teste de `resolveComponent`: ordem de declaração, nenhuma casa, `*`, permissões vazias (nega).

## Dúvidas para responder

- Variante por permissão vale só para a **tela inteira** ou também para **componentes dentro** da
  tela (cards, colunas, ações de linha)? A lista de desejos fala "por componente".
- Itens de menu de módulos sem permissão alguma ficam ocultos (assumido) ou aparecem desabilitados?
