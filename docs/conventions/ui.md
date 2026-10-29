# Convenções de UI

Regras de interface do `@platform/ui` e do `@platform/web`. Resumo em [AGENTS.md](../../AGENTS.md).

## Primitivos

- Todo elemento vem de `@platform/ui/components/*` (shadcn/ui sobre Base UI). Nada de HTML cru estilizado.
- Proibido criar componentes ou wrappers com `<div>` customizado sem aprovação explícita.
- Layout e tipografia fora de `packages/ui` usam `Stack`, `Grid`, `Show`, `Text`, `PageHeader`, `KpiCard` etc. de `@platform/ui/components/layout` (props tipadas). `pnpm check:ui` também inspeciona `integrations/*` e rejeita elementos HTML intrínsecos de layout/texto (`div`, `span`, `p`, `h1`–`h6`, `section`, `main`, ...), `className`/`style` em JSX e `Button` com `size` diferente de `"default"`/`"icon"`.
- Espaçamento: `gap` e `padding` aceitam só tokens semânticos, nunca números. `gap`: `tight` (4px, rótulo ↔ valor), `field` (8px, rótulo ↔ controle, ícone ↔ texto), `group` (12px, itens de um grupo dentro de um card), `section` (16px, blocos da página e cards entre si; padrão do `Grid` e do `AppMain`). `padding`: `compact` (8px, linhas e pílulas) e `card` (16px, igual ao padding do `Card`). Página = `<Stack gap="section">`.
- Bordas: `surface="card"` e `surface="muted"` do `Stack` já trazem borda (mesma cor do `Card`, `foreground/10`) e padding, para que barras de filtro e cards fiquem iguais. `Show` usa `on="lgUp"`/`"belowLg"` (breakpoint `lg`).
- Tema: somente claro (sem theme provider).
- Fronteira: fora de `packages/ui`, `pnpm check:ui` proíbe importar `sonner`, `@base-ui/react/*` e `@/components/ui`, e `open=`/`onOpenChange=` declarativos em Dialog/Sheet/AlertDialog/Popover.

## Botões

- Com texto: `size="default"` (ou omitir). Nunca `sm`, `xs` ou `lg`.
- Só ícone: `size="icon"`. Nunca `icon-sm` ou `icon-xs`.
- Exceção: o `X` interno do `SheetContent` (`icon-sm`), que é parte do primitivo.

## Formulários

- `<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormMessage>` com `react-hook-form` e `zodResolver`.
- Rótulos sempre com `<Label>`, nunca `<label>`.
- Dinheiro: `<MoneyInput />` (máscara em centavos, `R$ 0,00`). Nunca `<Input type="number" step="0.01" />`.
- Busca e inputs com ícone: `InputGroup`, `InputGroupAddon`, `InputGroupInput`. Nunca `<div className="relative">` com ícone absoluto.

## UI imperativa (`useUi()`)

- Janelas (dialog/sheet), confirmações e toasts via `useUi()` de `@platform/ui/imperative/provider`, montado uma vez pelo `UiProvider` em `main.tsx`.
- Conteúdo de janela usa `useWindow()` e `WindowActions` (ações do rodapé) de `@platform/ui/imperative/use-window`.

## Sheets

- Abertos pela superfície `"sheet"` de `useUi().windows.open`. O host implementa o layout; a janela renderiza só o corpo e publica as ações com `<WindowActions>`.
- Host: `SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl"`; `SheetHeader className="p-6 border-b shrink-0"`; `ScrollArea className="flex-1 min-h-0"` > `<div className="p-6 flex flex-col gap-6">`; `SheetFooter className="p-6 border-t shrink-0 flex flex-row justify-end gap-2 bg-popover"`.
- Drawer: a superfície `"drawer"` usa o mesmo layout, mas sobe de baixo (`side="bottom"`, até 85% da altura). É para ações no celular, como os filtros de um relatório.
- Submit: o botão usa `form="<id>"` e o corpo renderiza `<form id="<id>">`.
- Conteúdo longo: `ScrollArea`; strings técnicas longas (chaves de permissão) com `break-all`; controles (switches/botões) com `shrink-0`.

## Tabelas

- `DataTable` de `@platform/ui/data-table/data-table`: desktop renderiza `<Table>`, mobile renderiza `<MobileCard>` via `useIsMobile()`.
- Impressão: a prop opcional `print={{ orientation?, description? }}` liga o botão "Imprimir". Use em relatórios e registros (ex.: relatório InovaFarma, Audit Log), não em cadastros. O papel traz todas as linhas da busca e da ordenação atuais, sem paginação, sempre como tabela, com fundos, cabeçalho repetido por folha e rodapé "Emitido em" / "Página X de Y" (este só no Chrome/Edge). A escala reduz a tabela até caber na largura da folha A4. `orientation` padrão é `"portrait"`; use `"landscape"` para tabelas largas. `description` substitui a descrição no papel, por exemplo com os filtros ativos que a tela mostra fora da tabela. O botão fica desabilitado durante o carregamento, sem linhas ou com paginação no servidor.
- Comparação: a prop opcional `compare` da coluna devolve `{ previous, label, favorable? }` (ex.: o mesmo Colaborador no Período de Fechamento anterior). Requer `value` numérico e `format` numérico. No desktop, a célula inteira abre um tooltip compartilhado pela tabela (atual, anterior e variação), que não captura o mouse. No `MobileCard`, aparece uma linha abaixo do valor (`▲ 8,1% · 381`). Na impressão, nada aparece. Valores em `percent` comparam em p.p.; os demais, em variação percentual. Sem base (anterior zero), a comparação some.
- `rowActions` são filtradas pelas permissões do usuário; sem ação permitida, omitir o botão `...` e a coluna de ações. Nunca exibir slug técnico como fallback.

## KPIs

- `KpiCard` aceita `trend={{ current, previous, label, format, favorable? }}`: uma linha `▲ 12,2%` abaixo do valor e, ao passar o mouse, o mesmo detalhe do tooltip da tabela. `favorable` define a cor: `up` (padrão) pinta a alta de verde, `down` de vermelho (ex.: Descontos, CMV %) e `neutral` não pinta.

## Cabeçalho

- Ações primárias da página (`Atualizar`, `+ Novo...`) vão para a barra superior via `<HeaderActions>` (`packages/web/src/context/HeaderActionsContext.tsx`), liberando espaço vertical para as tabelas.

## Menus

- `DropdownMenu`: largura `w-auto min-w-48` e `whitespace-nowrap` nos itens.
