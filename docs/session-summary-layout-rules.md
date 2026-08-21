# Relatório Consolidado: Layout, Regras e Atualização do AGENTS.md

Este documento consolida todas as intervenções de **Layout**, **Componentização shadcn/ui**, **Regras Arquiteturais e Comportamentais** implementadas nesta sessão, além do planejamento para enriquecer o [AGENTS.md](../AGENTS.md).

---

## 1. O que foi Feito a Respeito de Layout & UI

### A. 100% Pure shadcn/ui & Eliminação de Gambiarras
- **Remoção de Divs Customizadas e Inline Styles**: Eliminados todos os `style={{...}}`, wrappers arbitrários e hacks de CSS em `IAMRolesPage.tsx`, `IAMUsersPage.tsx` e `SDUITable.tsx`.
- **Arquitetura Canônica de Scroll (Sheets e Modais)**:
  - Adicionado o componente oficial `<ScrollArea className="flex-1 min-h-0">` do shadcn.
  - Aplicado `break-all` nos identificadores longos e `shrink-0` nos switches para garantir responsividade perfeita sem truncamentos ou rolagem horizontal quebrada.

### B. Correção de DropdownMenu e Menus de Ações
- **Auto-dimensionamento de Menus**: Corrigido o `dropdown-menu.tsx` substituindo larguras forçadas por `w-auto min-w-48` e adicionando `whitespace-nowrap` nos itens, impedindo quebra feia de texto em botões de ação compactos (`...`).

### C. Gestão de Usuários (IAMUsersPage)
- **Display Name em vez de Slugs**: O `<SelectValue>` do Base UI agora renderiza o nome amigável do perfil (ex: *"Administrador do Sistema"*, *"Auditor Financeiro"*) através de `{roleId ? getRoleName(roleId) : undefined}`, eliminando o slug bruto `role_admin`.
- **Identificadores ERP em Card Canônico (Estilo Environment Variables)**:
  - As fontes oficiais (`inovafarma`, `sap`, etc.) são carregadas automaticamente do catálogo do sistema.
  - Cada fonte possui sua linha estruturada com ícone `Database`, nome em destaque e `<Input>` à direita para digitação direta do ID.
  - Removidos inputs manuais de "Source" e botões extras de inserção.
  - Os campos iniciam 100% limpos com placeholder *"Não vinculado"* (eliminado mock hardcoded).

### D. Otimização do Cabeçalho Superior (Header Bar Actions)
- **Criação do `<HeaderActions>`**: Criado o [HeaderActionsContext.tsx](../packages/web/src/context/HeaderActionsContext.tsx) integrado ao [AppLayout.tsx](../packages/web/src/components/layout/AppLayout.tsx).
- **Elevação dos Botões Primários**: Os botões `[Atualizar]` e `[+ Novo...]` de [WorkspacesPage.tsx](../packages/web/src/pages/WorkspacesPage.tsx), [IAMUsersPage.tsx](../packages/web/src/pages/IAMUsersPage.tsx) e [IAMRolesPage.tsx](../packages/web/src/pages/IAMRolesPage.tsx) agora ficam no topo à direita da barra de navegação, liberando espaço vertical valioso para as tabelas.
- **Limpeza Visual**: Removido o badge obsoleto *"Ambiente Seguro"* do header.

### E. SDUI Table & Permissões Estritas
- **Ocultação de Slugs Não Autorizados**: No [SDUITable.tsx](../packages/web/src/components/sdui/SDUITable.tsx), as ações são estritamente filtradas (`filter(id => Boolean(availableActions[id]))`). Ações sem permissão não exibem mais slugs técnicos no menu.
- **Controle de Exibição de Coluna**: Se uma linha ou tabela não possui nenhuma ação permitida para o usuário logado, o botão `...` e a coluna *"Ações"* são omitidos automaticamente.
- **Execução Segura de Ações e Confirmações**: Corrigido o fluxo de `ui.confirm` para evitar exclusões otimistas prematuras ao clicar em *Cancelar*, disparando re-fetch dinâmico da coleção apenas quando o usuário confirma.

---

## 2. O que foi Estabelecido a Respeito de Regras & Segurança

### A. Diretrizes Comportamentais Rígidas (Invariants)
1. **Invariante 14 — Proibição Absoluta de Adivinhação & Consulta Obrigatória à Documentação Oficial em TUDO**:
   - O agente assume como premissa que sua memória interna é desatualizada ou propensa a alucinações.
   - Consulta obrigatória às documentações oficiais para QUALQUER framework/biblioteca antes de propor ou alterar código.
   - Proibição absoluta de soluções improvisadas (*hacks*, *inline styles*, classes arbitrárias).
2. **Invariante 12 — Aprovação Passo a Passo Explícita**:
   - Proibição de decisões unilaterais de layout, regras ou arquitetura.
   - Cada ação precisa ser apresentada, explicada e aprovada pelo usuário antes da execução.
3. **Invariante 11 — Proibição de Divs Customizadas**:
   - Uso exclusivo dos componentes de `@/components/ui/*`.
4. **Invariante 13 — Tipagem TypeScript Estrita (Zero `unknown`/`any`)**:
   - Proibição de sniffing de tipos e uso de tipagens canônicas oficiais.

### B. Diretriz de Segurança Enterprise: Zero `localStorage`
- **Invariante de Sessão**:
  - `accessToken` (5 min): Mantido **exclusivamente na memória volátil** (variável JS).
  - `refreshToken` (7 dias): Armazenado **exclusivamente em Cookie `HttpOnly; SameSite=Lax; Path=/api/auth`** gerenciado pelos métodos canônicos do Hono (`getCookie`, `setCookie`, `deleteCookie` do `hono/cookie`).
  - Totalmente imune a ataques XSS e roubo de credenciais via JavaScript.
  - Renovação silenciosa contínua e automática no carregamento (F5) e ao interceptar status 401.

---

## 3. Planejamento para Atualização do `AGENTS.md`

Para garantir que futuras sessões e qualquer outro agente sigam exatamente os padrões refinados nesta sessão, propõe-se atualizar o [AGENTS.md](../AGENTS.md) com as seguintes adições:

### Adição 1: Especificação Estrita de Segurança de Sessão (Zero LocalStorage)
```markdown
### 15. Enterprise Session & Cookie Architecture (Zero LocalStorage)
- Access Tokens (5 min) MUST reside exclusively in JavaScript in-memory variables.
- Refresh Tokens (7 days) MUST be stored exclusively in `HttpOnly; SameSite=Lax; Path=/api/auth` cookies.
- NEVER store access tokens, refresh tokens, or user credentials in `localStorage` or `sessionStorage` (XSS vulnerability).
- Use canonical Hono helpers (`getCookie`, `setCookie`, `deleteCookie` from `hono/cookie`) for all cookie operations.
```

### Adição 2: Padrão Canônico de Ações no Header
```markdown
### 16. Top Header Actions Pattern
- Primary page-level actions (`Atualizar`, `+ Novo...`, `+ Nova Área`) MUST be projected to the top header bar via `<HeaderActions>`.
- Keep the page body clean and maximize vertical screen space for DataTables, Cards, and SDUI widgets.
```

### Adição 3: Filtragem Estrita de Permissões em Ações SDUI
```markdown
### 17. Strict Action Permissions Rendering in SDUI
- SDUI components MUST filter `rowActions` strictly against `availableActions` provided by the server schema.
- NEVER render technical slugs as fallbacks for unauthorized actions.
- Omit the action menu trigger (`...`) and the table action column entirely if no actions are authorized for the user.
```

### Adição 4: Padrão Canônico de Scroll em Sheets e Modais
```markdown
### 18. Canonical ScrollArea in Sheets & Modais
- Long modal or sheet content MUST be wrapped with `<ScrollArea className="flex-1 min-h-0">`.
- Long technical strings (such as permission keys) MUST include `break-all` and interactive controls (switches/buttons) MUST include `shrink-0` to avoid layout breaks.
```
