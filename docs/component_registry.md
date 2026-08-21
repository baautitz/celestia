# Component Registry — Celestia SDUI Platform

Registro completo de componentes da plataforma, divididos em **Componentes Declarativos** (árvore de layout e display) e **Componentes Imperativos** (invocados via código com `await ui.*`).

---

## PARTE 1: Componentes Imperativos (`ui.*` API)

Invocados diretamente no código TypeScript das actions via `await`, retornando Promises resolvidas na interação do usuário (estilo `MessageBox`, `InputBox` e `CommonDialog` da WinAPI/VBA).

```typescript
// Exemplo de fluxo operacional com componentes imperativos:
const ok = await ui.confirm("Aprovação", "Deseja aprovar a comissão?");
if (!ok) return;

const form = await ui.dialog.open({
  title: "Detalhes do Pagamento",
  fields: [
    { name: "valor", label: "Valor (R$)", type: "money", defaultValue: row.venda_geral * 0.05 },
    { name: "motivo", label: "Observação", type: "textarea" }
  ]
});
if (!form) return;

await persistence.push("comissoes", { valor: form.valor, motivo: form.motivo });
ui.toast.success("Comissão registrada com sucesso!");
ui.refresh();
```

### 1.1. Diálogos e Prompts Rápidos (`MessageBox` / `InputBox`)

| Método | Equivalente WinAPI | Retorno | Descrição |
| :--- | :--- | :--- | :--- |
| `await ui.alert(title, message)` | `MessageBox(..., MB_OK)` | `Promise<void>` | Modal de aviso simples com botão "OK" |
| `await ui.confirm(title, message)` | `MessageBox(..., MB_YESNO)` | `Promise<boolean>` | Diálogo de confirmação ("Confirmar" / "Cancelar") |
| `await ui.prompt(title, label, defaultValue?)` | `InputBox(...)` | `Promise<string \| null>` | Popup rápido com campo de texto único |

### 1.2. Formulários e Sub-Tabelas Modais (`DialogBoxParam`)

| Método | Equivalente WinAPI | Retorno | Descrição |
| :--- | :--- | :--- | :--- |
| `await ui.dialog.open({ title, fields })` | `DialogBoxParam(...)` | `Promise<FormData \| null>` | Modal com formulário dinâmico, validação Zod e campos configuráveis |
| `await ui.dialog.showTable({ title, source, columns, rowActions })` | Sub-Janela `ListView` | `Promise<void>` | Modal com sub-tabela paginada para visualização de coleções |
| `await ui.wizard.open({ title, steps })` | `PropertySheet` (Wizard) | `Promise<WizardData \| null>` | Assistente em etapas sequenciais com validação por passo |

### 1.3. Painéis Laterais (`Sheet` / `Drawer`)

| Método | Equivalente WinAPI | Retorno | Descrição |
| :--- | :--- | :--- | :--- |
| `await ui.sheet.open({ title, side, fields })` | Painel Lateral | `Promise<FormData \| null>` | Gaveta lateral deslizante para edição de formulários extensos |
| `await ui.sheet.showDetails({ title, data, fields })` | Propriedades | `Promise<void>` | Painel lateral de leitura/detalhes da linha selecionada |

### 1.4. Arquivos e Sistema (`CommonDialogs`)

| Método | Equivalente WinAPI | Retorno | Descrição |
| :--- | :--- | :--- | :--- |
| `await ui.filePicker.open({ accept })` | `GetOpenFileName` | `Promise<File \| null>` | Seletor nativo de arquivos |
| `ui.download({ filename, content, type })` | `GetSaveFileName` | `void` | Dispara download imediato (CSV, Excel, PDF, JSON) |
| `ui.print({ template, data })` | `PrintDlg` | `void` | Abre diálogo de impressão/PDF com template formatado |

### 1.5. Feedback e Notificações Não-Bloqueantes

| Método | Equivalente WinAPI | Retorno | Descrição |
| :--- | :--- | :--- | :--- |
| `ui.toast.success(message)` | Balloon Tooltip | `void` | Notificação temporária verde de sucesso |
| `ui.toast.error(message)` | Balloon Error | `void` | Notificação temporária vermelha de erro |
| `ui.toast.warning(message)` | Balloon Warning | `void` | Notificação temporária amarela de aviso |
| `ui.toast.info(message)` | Balloon Info | `void` | Notificação temporária azul informativa |

### 1.6. Controle de Estado e Progresso

| Método | Equivalente WinAPI | Retorno | Descrição |
| :--- | :--- | :--- | :--- |
| `ui.refresh()` | `InvalidateRect` | `void` | Recarrega e recalcula automaticamente todas as tabelas e KPIs |
| `ui.loading.show(message)` | `SetCursor(IDC_WAIT)` | `void` | Exibe overlay de carregamento global |
| `ui.loading.hide()` | `SetCursor(IDC_ARROW)` | `void` | Oculta overlay de carregamento |
| `ui.progress.set(percentage, label)` | `PBM_SETPOS` | `void` | Atualiza barra de progresso em operações em lote |

---

## PARTE 2: Componentes Declarativos (Árvore de Layout e Display)

Componentes definidos estaticamente na seção `ui` e nos `fields[]` dos formulários.

### 2.1. Form Fields (Entrada de Dados em Dialogs e Workspaces)

| # | `type` | WinAPI | shadcn/ui | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `text` | `EDIT` | `Input` | Campo de texto de linha única |
| 2 | `textarea` | `EDIT` (Multiline) | `Textarea` | Campo de texto multilinha |
| 3 | `number` | `EDIT` (Number) | `Input type="number"` | Campo numérico com incremento/decremento |
| 4 | `money` | `EDIT` + Mask | `MoneyInput` | Campo monetário formatado (R$ 0,00) com máscara automática e `inputMode="numeric"` |
| 5 | `select` | `COMBOBOX` | `Select` | Dropdown de seleção estática |
| 6 | `multi_select` | `LISTBOX` (Multi) | `Combobox` (Multi) | Seleção múltipla com tags/chips |
| 7 | `combobox` | `COMBOBOX` + Auto | `Combobox` | Select com busca/filtro local |
| 8 | `lookup_select` | `COMBOBOX` + Query | `Combobox` + Async | **Obrigatório:** Busca assíncrona no ERP (produtos, categorias) |
| 9 | `date` | `DATETIMEPICK_CLASS` | `DatePicker` | Seletor de data com calendário |
| 10 | `date_range` | `DATETIMEPICK_CLASS` (2x) | `DateRangePicker` | Seletor de intervalo (Data Inicial / Data Final) |
| 11 | `checkbox` | `BUTTON` (BS_CHECKBOX) | `Checkbox` | Booleano simples |
| 12 | `radio` | `BUTTON` (BS_RADIO) | `RadioGroup` | Seleção exclusiva em lista |
| 13 | `switch` | `BUTTON` (Toggle) | `Switch` | Alternador on/off visual |
| 14 | `hidden` | — | `Input type="hidden"` | Campo invisível com valor dinâmico |
| 15 | `search` | `EDIT` + Icon | `InputGroup` + `Search` | Campo de busca padronizado com `InputGroup`, `InputGroupAddon` e `InputGroupInput` |

### 2.2. Dashboard Display (Componentes Visuais da Tela)

| # | `type` | WinAPI | shadcn/ui | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| 16 | `data_table` | `WC_LISTVIEW` (Report) | `DataTable` | Tabela com ordenação, busca, paginação e row actions (desktop) |
| 17 | `mobile_card` | `WC_LISTVIEW` (Tile) | `MobileCard` | Card adaptativo estruturado para tabelas em visualização mobile |
| 18 | `stat_card` | `STATIC` + Icon | `Card` | Card de KPI com valor agregado, título e ícone |
| 19 | `bar_chart` | GDI Bar Chart | `Chart` (Recharts) | Gráfico de barras verticais ou horizontais |
| 20 | `line_chart` | GDI Line Chart | `Chart` (Recharts) | Gráfico de evolução temporal |
| 21 | `pie_chart` | GDI Pie Chart | `Chart` (Recharts) | Gráfico de pizza / distribuição percentual |
| 22 | `progress` | `PROGRESS_CLASS` | `Progress` | Barra de progresso estática (Meta vs Realizado) |
| 23 | `badge` | `STATIC` (Color) | `Badge` | Indicador visual de status (Aprovado, Pendente, etc.) |
| 24 | `label` | `STATIC` | `Label` | Rótulo de texto estático |
| 25 | `avatar` | `STATIC` (Icon) | `Avatar` | Imagem ou iniciais do usuário/vendedor |
| 26 | `empty_state` | — | Custom Component | Ilustração/mensagem de lista vazia |
| 27 | `skeleton` | — | `Skeleton` | Placeholder de carregamento |
| 28 | `separator` | `STATIC` (Etched) | `Separator` | Linha divisória horizontal ou vertical |

### 2.3. Layout e Estrutura

| # | `type` | WinAPI | shadcn/ui | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| 28 | `grid` | Layout Manager | CSS Grid (12 cols) | Container de layout responsivo com gap configurável |
| 29 | `card` | Window Frame | `Card` | Container visual para agrupar componentes |
| 30 | `tabs` | `WC_TABCONTROL` | `Tabs` | Abas para alternar múltiplas visualizações |
| 31 | `accordion` | Expand/Collapse | `Accordion` | Seções expansíveis para detalhes secundários |

### 2.4. Navegação, Feedback Inline e Ações

| # | `type` | WinAPI | shadcn/ui | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| 32 | `sidebar` | Menu Panel | `Sidebar` | Menu lateral retrátil da aplicação |
| 33 | `breadcrumb` | Path Links | `Breadcrumb` | Trilha de navegação hierárquica |
| 34 | `pagination` | Page Controls | `Pagination` | Paginação de tabelas |
| 35 | `alert` | Info Frame | `Alert` | Mensagem inline permanente (Avisos de limite, etc.) |
| 36 | `tooltip` | `TOOLTIPS_CLASS` | `Tooltip` | Ajuda contextual flutuante no hover |
| 37 | `dropdown_menu` | `TrackPopupMenu` | `DropdownMenu` | Menu suspenso de ações secundárias |
| 38 | `button` | `BUTTON` (Push) | `Button` | Botão de ação (primary, secondary, destructive, ghost) |
| 39 | `icon_button` | `BUTTON` (Icon) | `Button` + Icon | Botão compacto apenas com ícone para tabelas |
