import { handleArrowNavigation, handleArrowNavigationFocus } from "./arrow-navigation";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Printer,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { Button } from "../components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/input-group";
import { MobileCard } from "../components/mobile-card";
import { Skeleton } from "../components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/tooltip";
import {
  SharedTrendTooltip,
  TrendLine,
  TrendTooltipTrigger,
  useTrendTooltipHandle,
  type Trend,
  type TrendFormat,
} from "../components/trend";
import { useIsMobile } from "../hooks/use-mobile";
import { cn } from "../lib/utils";
import { rankBySearch } from "../lib/fuzzy-search";
import {
  formatCurrency,
  formatDate,
  formatDecimal,
  formatNumber,
  formatPercent,
} from "../lib/format";

export type CellValue = string | number | boolean | null | undefined;
export type DataTableFormat =
  "currency" | "date" | "decimal" | "number" | "percent";

const NUMERIC_FORMATS: ReadonlySet<DataTableFormat | undefined> =
  new Set<TrendFormat>(["currency", "decimal", "number", "percent"]);
const isNumericFormat = (format?: DataTableFormat): format is TrendFormat =>
  NUMERIC_FORMATS.has(format);
const isNumericColumn = (col: { format?: DataTableFormat }) =>
  isNumericFormat(col.format);
const isCenteredColumn = (col: { format?: DataTableFormat; centered?: boolean }) =>
  col.centered === true || col.format === "date";
/**
 * Números, datas e tags têm largura fixa (ou a do cabeçalho, se maior) e as colunas de texto ficam com o resto.
 * Assim a largura não depende do conteúdo, e as subtabelas de linhas expandidas ficam alinhadas entre si.
 */
const hasFixedWidth = (col: { format?: DataTableFormat; centered?: boolean }) =>
  isNumericColumn(col) || isCenteredColumn(col);
const FIXED_COLUMN_WIDTH_CLASS = "w-32";
/** Colunas que não quebram linha na impressão; as demais quebram para a tabela encolher menos. */
const NOWRAP_PRINT_FORMATS: ReadonlySet<DataTableFormat | undefined> = new Set([
  ...NUMERIC_FORMATS,
  "date",
]);
const wrapsInPrint = (col: { format?: DataTableFormat; nowrap?: boolean }) =>
  !col.nowrap && !NOWRAP_PRINT_FORMATS.has(col.format);

function HeaderLabel({ col }: { col: { label: string; tooltip?: string } }) {
  if (!col.tooltip) return <span>{col.label}</span>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="cursor-help">{col.label}</span>}
      />
      <TooltipContent>{col.tooltip}</TooltipContent>
    </Tooltip>
  );
}

export interface DataTableColumn<TRow> {
  key: string;
  label: string;
  /** O que sai na impressão no lugar do `render` (ex.: o valor de um campo editável, em texto). */
  printValue?: (row: TRow) => React.ReactNode;
  /** Linha vertical antes da coluna, como entre grupos (ex.: separar uma Meta da outra). */
  divider?: boolean;
  /** Explicação exibida em tooltip ao passar o mouse sobre o cabeçalho. */
  tooltip?: string;
  /** Rótulo do campo no MobileCard; padrão: `label`, prefixado pelo `group`. */
  mobileLabel?: string;
  /** Rótulo de um cabeçalho acima do `label`, mesclado entre colunas vizinhas do mesmo grupo. */
  group?: string;
  /** Mantém o conteúdo numa linha só, também na impressão (ex.: nomes que encareceriam a altura da linha). */
  nowrap?: boolean;
  /** `false` tira a alça de redimensionar desta coluna (a tabela redimensiona por padrão, ver `resizableColumns`). */
  resizable?: boolean;
  /** Largura máxima da célula no desktop, em caracteres (`ch`): o texto maior é cortado com reticências e o valor completo aparece em `title`. */
  truncateAt?: number;
  /** Valor bruto da célula; usado para formato, busca, ordenação e título do MobileCard. */
  value?: (row: TRow) => CellValue;
  /** Conteúdo customizado (badges etc.); tem precedência sobre `value`/`format` na célula. */
  render?: (row: TRow) => React.ReactNode;
  /** Coluna de tags (badges de situação, perfil etc.) ou de datas: cabeçalho e células centralizados. `format: "date"` já centraliza. */
  centered?: boolean;
  format?: DataTableFormat;
  sortable?: boolean;
  /** Direção do primeiro clique; o ciclo é primeira → oposta → padrão (sem ordenação). Padrão: "asc". */
  firstSort?: "asc" | "desc";
  /** Entra na busca local (requer `value`). */
  searchable?: boolean;
  /** Classes da célula no desktop (ex.: "font-mono text-xs text-muted-foreground"). */
  cellClassName?: string | ((row: TRow) => string | undefined);
  /** Classes do esqueleto de carregamento. Padrão: "h-4 w-full". */
  skeletonClassName?: string;
  /** Papel no MobileCard; colunas sem papel viram campos. */
  mobileRole?: "primary" | "secondary" | "hidden";
  /** Ocupa a linha inteira do MobileCard; use em colunas com controle editável. */
  mobileWide?: boolean;
  /**
   * Valor anterior da célula (ex.: o mesmo Colaborador no Período anterior); `undefined` = sem comparação.
   * Tooltip no desktop, linha abaixo do valor no MobileCard e nada na impressão. Requer `value` numérico.
   */
  compare?: (
    row: TRow,
  ) => Pick<Trend, "previous" | "label" | "favorable"> | undefined;
}

/** Valores do Totalizador por `key` de coluna. */
export type TotalsValues = Record<string, CellValue>;

export type DataTableTotals<TRow> =
  TotalsValues | ((filteredRows: TRow[]) => TotalsValues);

export type DataTablePagination =
  | { pageSize: number }
  | { page: number; totalPages: number; onPageChange: (page: number) => void };

export type DataTablePrintOrientation = "portrait" | "landscape";

export interface DataTablePrintOptions<TRow = unknown> {
  /** Orientação da folha A4. Padrão: "portrait". */
  orientation?: DataTablePrintOrientation;
  /** Substitui `description` no papel (ex.: filtros ativos que a tela mostra fora da tabela). */
  description?: string;
  /** Nome sugerido ao salvar como PDF (vira o título da página durante a impressão). Padrão: `title`. */
  fileName?: string;
  /**
   * Detalhe impresso logo abaixo de cada linha, na mesma página que ela (ex.: as Metas de cada Colaborador).
   * Use `<PrintDetailTable>` para uma subtabela compacta.
   */
  details?: (row: TRow) => React.ReactNode;
  /** Antes de imprimir (ex.: um modal de opções); `false` cancela a impressão. */
  prepare?: () => Promise<boolean>;
  /** Colunas do papel; padrão: as da tela. Lidas depois do `prepare`, que pode mudá-las. */
  columns?: DataTableColumn<TRow>[];
}

export interface DataTableProps<TRow> {
  columns: DataTableColumn<TRow>[];
  /** `key` das colunas exibidas, na ordem de `columns`; sem ela, todas aparecem. Quem usa a tabela decide o que mostrar. */
  visibleColumns?: string[];
  rows: TRow[];
  getRowId: (row: TRow) => string;
  loading?: boolean;
  skeletonRows?: number;
  /** Texto, ou função recebendo a quantidade de linhas após a busca. */
  title?: string | ((count: number) => string);
  /** Conteúdo à direita do cabeçalho do card (ex.: um checkbox de escopo), junto da busca e da impressão. */
  headerActions?: React.ReactNode;
  /** Linhas e cabeçalho mais baixos, com texto menor: cabem mais linhas na tela (ex.: grades de trabalho). */
  compact?: boolean;
  description?: string;
  emptyMessage?: string;
  rowActions?: (row: TRow) => React.ReactNode;
  /** Detalhes da linha; quando informado, cada linha ganha um botão de expandir/recolher. */
  renderExpanded?: (row: TRow) => React.ReactNode;
  /** Com `renderExpanded`, as linhas já começam expandidas. */
  defaultExpanded?: boolean;
  /**
   * `page`: a tabela cresce com as linhas e quem rola é a página (sem rolagem vertical dentro da tabela).
   * Bom para tabelas expansíveis, que senão viram uma rolagem dentro da outra. O cabeçalho gruda abaixo da barra
   * superior ao rolar a página, salvo quando a tabela não cabe na largura e rola na horizontal. Padrão: `table`.
   * `fill`: a partir de `@4xl` a tabela ocupa a altura que o pai der (célula de `Grid columns="workspace"`) e só o corpo rola;
   * abaixo disso, igual a `table`.
   */
  scroll?: "table" | "page" | "fill";
  /**
   * Janela de linhas: só as visíveis (mais uma folga) ficam no DOM; o resto vira espaçadores com a altura delas.
   * Padrão: ligado com `scroll="fill"` e mais de 200 linhas. Pressupõe linhas de altura uniforme (a da primeira
   * linha medida); não vale com `renderExpanded`, paginação ou no mobile.
   */
  virtualize?: boolean;
  actionsLabel?: string;
  actionsHeadClassName?: string;
  actionsSkeletonClassName?: string;
  search?: {
    placeholder?: string;
    className?: string;
    /** Textos a mais que a busca local considera além das colunas `searchable` (ex.: o que está na linha expandida). */
    fields?: (row: TRow) => string[];
  };
  pagination?: DataTablePagination;
  /** Ordenação/busca/paginação feitas fora: a tabela só exibe `rows`. */
  manual?: boolean;
  /** `order` null = voltou à ordem padrão. */
  onSortChange?: (key: string, order: "asc" | "desc" | null) => void;
  onSearchChange?: (value: string) => void;
  /** Envolve a tabela desktop em `border border-border` (visual do SDUITable). */
  bordered?: boolean;
  className?: string;
  /** Liga o botão "Imprimir": todas as linhas da busca/ordenação atuais, sem a paginação. */
  print?: DataTablePrintOptions<TRow>;
  /** Alterna o fundo das linhas, na tela e na impressão, para guiar a leitura de tabelas largas. */
  striped?: boolean;
  /** Destaca a linha com um tom âmbar suave (ex.: alteração ainda não gravada). A seleção por clique vence o destaque. */
  highlightRow?: (row: TRow) => boolean;
  /** `key` da última coluna presa à esquerda na rolagem horizontal; ela e as anteriores ficam fixas. Não afeta a impressão. */
  frozenUntil?: string;
  /** Alça no cabeçalho para o usuário arrastar a largura de cada coluna (duplo clique restaura); só no desktop. Padrão: `true`. */
  resizableColumns?: boolean;
  /** Identifica a tabela para lembrar as larguras escolhidas entre visitas (localStorage); sem ele, valem só enquanto a tabela está aberta. */
  resizeKey?: string;
  /** Ligado por padrão: setas movem o foco entre os campos de valor das células, como numa planilha (↑/↓ e Enter trocam de linha); chaves e botões ficam fora. Passe `false` para desligar. */
  arrowNavigation?: boolean;
  /**
   * Linha ativa (cursor) controlada por quem usa a tabela; informar `onActiveRowChange` liga o teclado nas linhas:
   * ↑/↓ movem a linha ativa, Espaço chama `onRowToggle`, a primeira linha visível fica ativa sozinha e a tabela
   * pega o foco ao carregar (salvo se o foco já estiver num campo ou janela).
   */
  activeRowId?: string | null;
  onActiveRowChange?: (id: string | null) => void;
  /** Espaço na linha ativa (ex.: marcar/desmarcar o checkbox dela). */
  onRowToggle?: (row: TRow) => void;
  /**
   * Totalizador: valores por `key` de coluna, calculados por quem usa a tabela e formatados pelo `format` da coluna.
   * A função recebe as linhas da busca atual, de todas as páginas; o objeto serve ao modo `manual` e a tabelas sem busca.
   */
  totals?: DataTableTotals<TRow>;
  /** Valor anterior de cada total, por `key` de coluna (ex.: o total do Período anterior); mesmo efeito do `compare` da coluna. */
  totalsCompare?: Record<
    string,
    Pick<Trend, "previous" | "label" | "favorable">
  >;
}
/** Chave da coluna do botão de expandir na medição das colunas fixas. */
const EXPAND_KEY = "__expand";

/** Fundos opacos (mistura sobre `--background`) para as células fixas não deixarem o conteúdo rolado aparecer por baixo. */
const FROZEN_HEAD_CLASS =
  "bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))]";
const FROZEN_CELL_CLASS =
  "bg-background group-hover/row:bg-[color-mix(in_oklab,var(--primary)_5%,var(--background))] group-data-[state=selected]/row:bg-[color-mix(in_oklab,var(--primary)_15%,var(--background))]!";
/** Linha destacada: o âmbar vale também nas células fixas, que têm fundo opaco próprio. */
const HIGHLIGHT_ROW_CLASS = "data-[highlight=true]:bg-amber-500/10";
const FROZEN_HIGHLIGHT_CELL_CLASS = "group-data-[highlight=true]/row:bg-[color-mix(in_oklab,var(--color-amber-500)_10%,var(--background))]";
const FROZEN_STRIPED_CELL_CLASS =
  "group-even/row:bg-[color-mix(in_oklab,var(--muted)_20%,var(--background))]";
/** Linha clicada: destaque que vence o zebrado e o hover. */
const SELECTED_ROW_CLASS = "data-[state=selected]:bg-primary/15!";
/** Cliques nestes elementos são deles, não selecionam a linha. */
const INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, label, [role=button], [role=checkbox], [role=combobox], [role=menuitem]";
/** Uma tabela dentro da linha expandida de outra: o cabeçalho dela não gruda, quem gruda é o da de fora. */
const NestedTableContext = createContext(false);

/**
 * Cabeçalho grudado só com CSS. Com `scroll="page"` e a tabela cabendo na largura, o contêiner não rola
 * e o cabeçalho gruda na rolagem da página, abaixo da barra superior (`--table-sticky-top`, definida em `AppMain`).
 * Larga demais, o contêiner rola na horizontal e o cabeçalho deixa de grudar; com `scroll="table"` gruda dentro dele.
 */
/**
 * A cópia grudada do cabeçalho acompanha a rolagem lateral do contêiner por uma animação ligada à rolagem
 * (`animation-timeline`), que roda no compositor junto com o scroll; sincronizar por `scrollLeft` num evento ficava
 * um quadro atrás e o cabeçalho piscava. Sem suporte, cai no `scrollLeft`.
 */
const HEAD_FOLLOWS_SCROLL =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("animation-timeline: --x");
const HEAD_TIMELINE = "--celestia-table-x";
// Com colunas fixas, a animação roda célula a célula nas não fixas (as fixas ficam paradas), em vez de na tabela inteira.
const HEAD_SCROLL_KEYFRAMES = `@keyframes celestia-head-x{to{transform:translateX(calc(var(--head-max,0px)*-1))}}[data-head-frozen] th:not([style*="sticky"]){animation:celestia-head-x linear both;animation-timeline:${HEAD_TIMELINE}}`;

const PAGE_STICKY_HEAD_CLASS = "top-(--table-sticky-top,0px)";

/**
 * Linhas de 2px no fim do cabeçalho fixo e da última coluna fixa. Sombra interna em vez de borda:
 * com `border-collapse`, a borda de uma célula `sticky` fica para trás quando a tabela rola.
 */
const HEADER_EDGE_CLASS = "shadow-[inset_0_-2px_0_var(--border)]";
const FROZEN_EDGE_CLASS = "shadow-[inset_-2px_0_0_var(--border)]";
const FROZEN_HEADER_EDGE_CLASS = "shadow-[inset_-2px_-2px_0_var(--border)]";
/** No papel nada rola: as mesmas linhas da tela, como bordas comuns. */
const PRINT_LINE_COLOR = "border-border";

function mobileLabel(col: {
  label: string;
  mobileLabel?: string;
  group?: string;
}): string {
  return (
    col.mobileLabel ?? (col.group ? `${col.group} · ${col.label}` : col.label)
  );
}

/** Linha de cabeçalho com os grupos de colunas; não renderiza nada quando nenhuma coluna tem `group`. */
function GroupHeaderRow({
  columns,
  leading = 0,
  trailing = 0,
  frozenKeys = [],
  frozenHead,
  force = false,
}: {
  /** Renderiza a linha mesmo sem grupos nestas colunas (a outra metade do cabeçalho tem). */
  force?: boolean;
  columns: { key: string; group?: string }[];
  leading?: number;
  trailing?: number;
  /** Colunas fixas: um grupo não se mescla por cima da fronteira entre fixas e roláveis. */
  frozenKeys?: readonly string[];
  /** Estilo e classes de uma célula fixa, pela chave da primeira e da última coluna que ela cobre. */
  frozenHead?: (
    firstKey: string,
    lastKey: string,
  ) => { style?: React.CSSProperties; className?: string | false };
}) {
  if (!force && !columns.some((c) => c.group)) return null;
  const boundaries = groupBoundaryKeys(columns);
  const spans: {
    key: string;
    lastKey: string;
    group?: string;
    frozen: boolean;
    span: number;
  }[] = [];
  for (const col of columns) {
    const last = spans[spans.length - 1];
    const frozen = frozenKeys.includes(col.key);
    if (last && last.group === col.group && last.frozen === frozen) {
      last.span++;
      last.lastKey = col.key;
    } else
      spans.push({
        key: col.key,
        lastKey: col.key,
        group: col.group,
        frozen,
        span: 1,
      });
  }
  const leadingHead =
    frozenKeys.length > 0 ? frozenHead?.(EXPAND_KEY, EXPAND_KEY) : undefined;
  return (
    <TableRow className="bg-muted/40">
      {leading > 0 && (
        <TableHead
          colSpan={leading}
          style={leadingHead?.style}
          className={cn(leadingHead?.className)}
        />
      )}
      {spans.map(({ key, lastKey, group, frozen, span }, i) => {
        const head = frozen ? frozenHead?.(key, lastKey) : undefined;
        return (
          <TableHead
            key={key}
            colSpan={span}
            style={head?.style}
            className={cn(
              "h-8",
              group && "text-center",
              boundaries.has(key) && !(spans[i - 1]?.frozen && !frozen) && GROUP_BOUNDARY_CLASS,
              head?.className,
            )}
          >
            {group}
          </TableHead>
        );
      })}
      {trailing > 0 && <TableHead colSpan={trailing} />}
    </TableRow>
  );
}

/** Colunas que começam ou encerram um grupo ganham uma divisória à esquerda, do cabeçalho ao corpo. */
function groupBoundaryKeys(
  columns: { key: string; group?: string; divider?: boolean }[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  columns.forEach((col, i) => {
    const prev = columns[i - 1];
    if (prev && (col.divider || (prev.group !== col.group && (prev.group || col.group))))
      keys.add(col.key);
  });
  return keys;
}

const GROUP_BOUNDARY_CLASS = "border-l border-border";

function columnCellClassName<TRow>(
  col: DataTableColumn<TRow>,
  row: TRow,
): string | undefined {
  return cn(
    isNumericColumn(col) && "text-right tabular-nums",
    isCenteredColumn(col) && "text-center",
    col.nowrap && "whitespace-nowrap",
    typeof col.cellClassName === "function"
      ? col.cellClassName(row)
      : col.cellClassName,
  );
}

/** Classes de uma célula do Totalizador: o alinhamento e a fonte da coluna, sem as que dependem da linha. */
function totalsCellClassName<TRow>(
  col: DataTableColumn<TRow>,
): string | undefined {
  return cn(
    isNumericColumn(col) && "text-right tabular-nums",
    isCenteredColumn(col) && "text-center",
    col.nowrap && "whitespace-nowrap",
    typeof col.cellClassName === "string" && col.cellClassName,
  );
}

function cellTrend<TRow>(
  col: DataTableColumn<TRow>,
  row: TRow,
): Trend | undefined {
  const current = col.value?.(row);
  const compared = col.compare?.(row);
  if (!compared || typeof current !== "number" || !isNumericFormat(col.format))
    return undefined;
  return { ...compared, current, format: col.format };
}

function formatValue(value: CellValue, format?: DataTableFormat): string {
  if (value === undefined || value === null) return "-";
  if (typeof value === "boolean") return String(value);
  if (format === "currency") return formatCurrency(value);
  if (format === "date") return formatDate(String(value));
  if (format === "decimal") return formatDecimal(value);
  if (format === "number") return formatNumber(value);
  if (format === "percent") return formatPercent(value);
  return String(value);
}

const TOTAL_LABEL = "Total";
/** Classes do Totalizador, na tela e no papel: negrito e borda superior destacada. */
const TOTALS_CLASS = "font-bold border-t-2 border-border bg-muted/40";

/** Texto da célula do Totalizador: o rótulo na primeira coluna (prevalece sobre um valor dela), em branco sem valor. */
function totalCellText(
  col: { key: string; format?: DataTableFormat },
  index: number,
  totals: TotalsValues,
): string {
  if (index === 0) return TOTAL_LABEL;
  return col.key in totals ? formatValue(totals[col.key], col.format) : "";
}

/**
 * Linha do corpo memorizada: selecionar ou expandir uma linha só redesenha as linhas cujo `deps` mudou
 * (a que ganhou e a que perdeu o destaque), não a tabela inteira. `deps` lista tudo de que a linha depende.
 */
const VIRTUALIZE_MIN_ROWS = 200;
const VIRTUAL_OVERSCAN = 10;

/** Linha vazia que ocupa o lugar das linhas fora da janela. */
function VirtualSpacer({ height, span }: { height: number; span: number }) {
  return (
    <tr aria-hidden data-virtual-spacer="">
      <td colSpan={span} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );
}

const MemoRow = React.memo(
  function MemoRow({ render }: { render: () => React.ReactNode; deps: readonly unknown[] }) {
    return <>{render()}</>;
  },
  (a, b) => a.deps.length === b.deps.length && a.deps.every((d, i) => Object.is(d, b.deps[i])),
);

export function DataTable<TRow>({
  columns: allColumns,
  visibleColumns,
  rows,
  getRowId,
  loading = false,
  skeletonRows = 4,
  title,
  headerActions,
  compact = false,
  description,
  emptyMessage = "Nenhum registro encontrado.",
  rowActions,
  renderExpanded,
  defaultExpanded = false,
  scroll = "table",
  virtualize,
  actionsLabel = "Ações",
  actionsHeadClassName = "text-center w-20",
  actionsSkeletonClassName = "h-8 w-8 mx-auto",
  search,
  pagination,
  manual = false,
  onSortChange,
  onSearchChange,
  bordered = false,
  className,
  print,
  striped = false,
  highlightRow,
  frozenUntil,
  resizableColumns = true,
  resizeKey,
  arrowNavigation = true,
  activeRowId,
  onActiveRowChange,
  onRowToggle,
  totals,
  totalsCompare,
}: DataTableProps<TRow>) {
  const columns = useMemo(
    () => (visibleColumns ? allColumns.filter((c) => visibleColumns.includes(c.key)) : allColumns),
    [allColumns, visibleColumns],
  );
  const isMobile = useIsMobile();
  const searchFields = search?.fields;
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | undefined>(undefined);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [clientPage, setClientPage] = useState(1);
  // Linhas que o usuário alternou; expandida = alternada XOR `defaultExpanded`.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Buscar com tudo recolhido expande as linhas encontradas; limpar a busca recolhe de novo.
  const [expandedBySearch, setExpandedBySearch] = useState(false);
  const isExpanded = (id: string) => expandedIds.has(id) !== (defaultExpanded || expandedBySearch);
  const [printing, setPrinting] = useState(false);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const rowCursor = onActiveRowChange !== undefined;
  const selectedId = rowCursor ? (activeRowId ?? null) : localSelectedId;
  const setSelectedId = (id: string | null) => {
    setLocalSelectedId(id);
    onActiveRowChange?.(id);
  };
  const nested = useContext(NestedTableContext);
  // Clicar fora da tabela tira o destaque da linha.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setSelectedId só repassa ao pai.
  useEffect(() => {
    if (selectedId === null || rowCursor) return;
    const clear = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setSelectedId(null);
    };
    document.addEventListener("pointerdown", clear);
    return () => document.removeEventListener("pointerdown", clear);
  }, [selectedId, rowCursor]);
  const containerRef = useRef<HTMLDivElement>(null);
  // O cabeçalho só gruda na página enquanto a tabela cabe na largura: larga demais, o contêiner rola na horizontal.
  const [fitsWidth, setFitsWidth] = useState(true);
  const pageScroll = scroll === "page" && fitsWidth;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `isMobile` não é lido no efeito, mas a troca de layout exige medir a tabela de novo.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const table = container?.firstElementChild as HTMLElement | null;
    if (scroll !== "page" || !container || !table || typeof ResizeObserver === "undefined") return;
    const measure = () => setFitsWidth(table.offsetWidth <= container.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(table);
    return () => observer.disconnect();
  }, [scroll, isMobile]);

  // Tabela larga com rolagem da página: o contêiner rola na horizontal e o `sticky` do cabeçalho real só enxergaria ele.
  // Uma cópia do cabeçalho, fora do contêiner, gruda na página; cobre o real (margem negativa) e acompanha a rolagem
  // lateral. Uma barra de rolagem grudada no rodapé da tela substitui a do contêiner, que fica no fim da tabela.
  const headRef = useRef<HTMLTableSectionElement>(null);
  const stickyHeadRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const [wideLayout, setWideLayout] = useState<{
    tableWidth: number;
    columnWidths: number[];
    headHeight: number;
    maxScroll: number;
  } | null>(null);
  const isWide = scroll === "page" && !fitsWidth && !isMobile && !nested;
  const wide = isWide ? wideLayout : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `columns` não é lido no efeito, mas colunas novas mudam as larguras que o efeito mede.
  useLayoutEffect(() => {
    const head = headRef.current;
    const table = head?.parentElement;
    if (!isWide || !head || !table || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const cells = Array.from(head.querySelectorAll<HTMLElement>("tr:last-child > th"));
      const next = {
        tableWidth: table.offsetWidth,
        columnWidths: cells.map((c) => c.getBoundingClientRect().width),
        headHeight: head.offsetHeight,
        maxScroll: Math.max(0, (containerRef.current?.scrollWidth ?? 0) - (containerRef.current?.clientWidth ?? 0)),
      };
      // Mesmas medidas: mantém o objeto, senão a cópia do cabeçalho redesenha e volta o `scrollLeft` no meio da rolagem.
      setWideLayout((prev) =>
        prev &&
        prev.tableWidth === next.tableWidth &&
        prev.headHeight === next.headHeight &&
        prev.maxScroll === next.maxScroll &&
        prev.columnWidths.length === next.columnWidths.length &&
        prev.columnWidths.every((w, i) => w === next.columnWidths[i])
          ? prev
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    observer.observe(head);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isWide, columns]);
  const syncScroll = (e: React.UIEvent<HTMLElement>) => {
    const left = e.currentTarget.scrollLeft;
    for (const el of [containerRef.current, stickyHeadRef.current, scrollbarRef.current]) {
      if (el === stickyHeadRef.current && HEAD_FOLLOWS_SCROLL) continue;
      if (el && el !== e.currentTarget && el.scrollLeft !== left) el.scrollLeft = left;
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: `wide` não é lido no efeito, mas a cópia do cabeçalho nova precisa partir da rolagem atual.
  useLayoutEffect(() => {
    // Ao montar a cópia (ou trocar as larguras), ela parte da posição lateral atual da tabela.
    const left = containerRef.current?.scrollLeft ?? 0;
    if (stickyHeadRef.current && !HEAD_FOLLOWS_SCROLL) stickyHeadRef.current.scrollLeft = left;
    if (scrollbarRef.current) scrollbarRef.current.scrollLeft = left;
  }, [wide]);
  const trendTooltip = useTrendTooltipHandle();
  const endPrinting = useCallback(() => setPrinting(false), []);
  const headRefs = useRef(new Map<string, HTMLTableCellElement>());
  const [frozenLeft, setFrozenLeft] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );

  const frozenCount = columns.findIndex((c) => c.key === frozenUntil) + 1;
  const frozenKeys = columns.slice(0, frozenCount).map((c) => c.key);
  const lastFrozenKey = frozenKeys[frozenKeys.length - 1];
  const frozenSignature = frozenKeys.join("|");
  const frozenCells = frozenCount > 0 ? frozenCount + (renderExpanded ? 1 : 0) : 0;

  // Cada coluna fixa fica à esquerda da soma das larguras das fixas anteriores (e do botão de expandir).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rows` não é lido no efeito, mas linhas novas podem mudar as larguras das colunas fixas.
  useLayoutEffect(() => {
    const measure = () => {
      let left = headRefs.current.get(EXPAND_KEY)?.offsetWidth ?? 0;
      const next = new Map<string, number>();
      for (const key of frozenSignature ? frozenSignature.split("|") : []) {
        next.set(key, left);
        left += headRefs.current.get(key)?.offsetWidth ?? 0;
      }
      // Mesmas posições: mantém o Map, senão toda linha (que depende dele) redesenha a cada mudança de `rows`.
      setFrozenLeft((prev) =>
        prev.size === next.size && [...next].every(([k, v]) => prev.get(k) === v) ? prev : next,
      );
    };
    measure();
    if (!frozenSignature || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const el of headRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [frozenSignature, rows]);

  const frozenStyle = (
    key: string,
    head = false,
  ): React.CSSProperties | undefined =>
    frozenKeys.includes(key) || (key === EXPAND_KEY && frozenCount > 0)
      ? {
          position: "sticky",
          left: frozenLeft.get(key) ?? 0,
          zIndex: head ? 20 : 1,
        }
      : undefined;
  const frozenClass = (key: string, head = false) =>
    (frozenKeys.includes(key) || (key === EXPAND_KEY && frozenCount > 0)) &&
    cn(
      head
        ? FROZEN_HEAD_CLASS
        : cn(FROZEN_CELL_CLASS, striped && FROZEN_STRIPED_CELL_CLASS, FROZEN_HIGHLIGHT_CELL_CLASS),
    );
  /** Linha inferior do cabeçalho de colunas, que dobra como borda direita na última coluna fixa. */
  const headerEdgeClass = (key: string) =>
    key === lastFrozenKey ? FROZEN_HEADER_EDGE_CLASS : HEADER_EDGE_CLASS;
  /** A 1ª coluna após as fixas já tem a linha de 2px da última fixa: sem a borda de grupo, para não duplicar. */
  const boundaryClass = (key: string) =>
    boundaries.has(key) && !(frozenCount > 0 && key === columns[frozenCount]?.key) && GROUP_BOUNDARY_CLASS;
  const setHeadRef = (key: string) => (el: HTMLTableCellElement | null) => {
    if (el) headRefs.current.set(key, el);
    else headRefs.current.delete(key);
  };

  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const expandButton = (row: TRow) => {
    const id = getRowId(row);
    const expanded = isExpanded(id);
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-expanded={expanded}
        aria-label={expanded ? "Recolher linha" : "Expandir linha"}
        onClick={() => toggleExpanded(id)}
      >
        <ChevronDown className={expanded ? "size-4" : "size-4 -rotate-90"} />
      </Button>
    );
  };

  // No celular: botão largo, entre os campos e o conteúdo que ele abre.
  const mobileExpandButton = (row: TRow) => {
    const id = getRowId(row);
    const expanded = isExpanded(id);
    return (
      <Button
        variant="outline"
        className="w-full justify-between"
        aria-expanded={expanded}
        aria-label={expanded ? "Recolher linha" : "Expandir linha"}
        onClick={() => toggleExpanded(id)}
      >
        {expanded ? "Ocultar detalhes" : "Ver detalhes"}
        <ChevronDown className={expanded ? "size-4 rotate-180" : "size-4"} />
      </Button>
    );
  };

  const text = (col: DataTableColumn<TRow>, row: TRow): string =>
    formatValue(col.value?.(row), col.format);

  // Memorizado: mover o cursor ou marcar uma linha redesenha a tabela, mas não reordena/busca de novo milhares de linhas.
  const sorted = useMemo(() => {
    let visible = rows;
    if (!manual) {
      // Busca por palavras (acentos e um erro de digitação tolerados), da mais relevante à menos.
      // Uma ordenação escolhida no cabeçalho prevalece; como é estável, a relevância desempata.
      const searchCols = columns.filter((c) => c.searchable);
      visible = rankBySearch(visible, query, (row) => [
        ...searchCols.map((c) => String(c.value?.(row) ?? "")),
        ...(searchFields?.(row) ?? []),
      ]);
      const sortCol = columns.find((c) => c.key === sortKey);
      if (sortCol?.value) {
        const get = sortCol.value;
        const dir = order === "asc" ? 1 : -1;
        visible = [...visible].sort((a, b) => {
          const x = get(a);
          const y = get(b);
          if (typeof x === "number" && typeof y === "number")
            return (x - y) * dir;
          return String(x ?? "").localeCompare(String(y ?? ""), "pt-BR") * dir;
        });
      }
    }
    return visible;
  }, [rows, columns, manual, query, sortKey, order, searchFields]);
  let visible = sorted;
  const count = visible.length;
  const printRows = visible;
  const firstVisibleId = visible[0] ? getRowId(visible[0]) : null;
  const virtualOn =
    (virtualize ?? (scroll === "fill" && count > VIRTUALIZE_MIN_ROWS)) && !pagination && !renderExpanded && !isMobile && !loading && count > 0;
  const [startIdx, setStartIdx] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [measured, setMeasured] = useState<{ row: number; head: number } | null>(null);
  const rowH = measured?.row ?? (compact ? 29 : 41);
  const headH = measured?.head ?? 32;
  const viewportH = viewH || 600;
  const winStart = virtualOn ? Math.max(0, Math.min(startIdx, count - 1) - VIRTUAL_OVERSCAN) : 0;
  const winEnd = virtualOn ? Math.min(count, Math.min(startIdx, count - 1) + Math.ceil(viewportH / rowH) + VIRTUAL_OVERSCAN) : count;
  const activeVisible = selectedId !== null && visible.some((r) => getRowId(r) === selectedId);
  // Cursor de linhas: sem linha ativa na lista (carga nova, busca), a primeira visível assume.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setSelectedId só repassa ao pai.
  useEffect(() => {
    if (rowCursor && !loading && firstVisibleId !== null && !activeVisible) setSelectedId(firstVisibleId);
  }, [rowCursor, loading, firstVisibleId, activeVisible]);
  // A tabela pega o foco quando as linhas chegam, para as setas valerem sem clicar; não rouba de campo ou janela.
  useEffect(() => {
    if (!rowCursor || loading || rows.length === 0) return;
    const el = document.activeElement;
    if (el && el !== document.body && (el.matches("input, textarea, select, [contenteditable]") || el.closest('[role="dialog"], [data-arrow-root]'))) return;
    cursorRootRef.current?.focus({ preventScroll: true });
  }, [rowCursor, loading, rows]);
  // A linha ativa acompanha o cursor dentro da área rolável.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só quando o cursor se move.
  useEffect(() => {
    if (!rowCursor || selectedId === null) return;
    const box = containerRef.current;
    if (virtualOn && box) {
      // Linha possivelmente fora da janela: ajusta a rolagem pela conta (cada linha tem `rowH`) e a janela acompanha.
      const idx = visible.findIndex((r) => getRowId(r) === selectedId);
      if (idx < 0) return;
      const area = box.clientHeight > 0 ? box.clientHeight - headH : viewportH - headH;
      const top = idx * rowH;
      if (top < box.scrollTop) box.scrollTop = top;
      else if (top + rowH > box.scrollTop + area) box.scrollTop = top + rowH - area;
      setStartIdx(Math.floor(box.scrollTop / rowH));
      return;
    }
    const tr = cursorRootRef.current?.querySelector(`tr[data-row-id="${CSS.escape(selectedId)}"]`);
    if (tr && typeof tr.scrollIntoView === "function") tr.scrollIntoView({ block: "nearest" });
  }, [rowCursor, selectedId]);
  // Janela de linhas: mede a altura da viewport, do cabeçalho e de uma linha; busca/ordenação voltam ao topo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: remede quando a lista ou o modo mudam.
  useLayoutEffect(() => {
    const box = containerRef.current;
    if (!virtualOn || !box) return;
    const row = box.querySelector<HTMLElement>("tbody tr[data-row-id]")?.offsetHeight ?? 0;
    const head = box.querySelector<HTMLElement>("thead")?.offsetHeight ?? 0;
    if (row > 0 && head > 0) setMeasured((m) => (m && m.row === row && m.head === head ? m : { row, head }));
    setViewH(box.clientHeight);
  }, [virtualOn, compact, count]);
  useEffect(() => {
    const box = containerRef.current;
    if (!virtualOn || !box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewH(box.clientHeight));
    observer.observe(box);
    return () => observer.disconnect();
  }, [virtualOn]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: só ao mudar a busca ou a ordenação.
  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setStartIdx(0);
  }, [query, sortKey, order]);
  const cursorRootRef = useRef<HTMLDivElement>(null);
  const handleRowCursorKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!rowCursor || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
    if ((e.target as Element).closest('input, textarea, select, [role="combobox"], [role="listbox"], [role="menu"]')) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const at = visible.findIndex((r) => getRowId(r) === selectedId);
      const next = visible[Math.max(0, Math.min(visible.length - 1, at < 0 ? 0 : at + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) setSelectedId(getRowId(next));
      e.preventDefault();
    } else if (e.key === " " && onRowToggle) {
      const row = visible.find((r) => getRowId(r) === selectedId);
      if (row) onRowToggle(row);
      e.preventDefault();
    }
  };
  const totalsValues =
    typeof totals === "function" ? totals(printRows) : totals;

  let page = 1;
  let totalPages = 1;
  let goTo: ((p: number) => void) | undefined;
  if (pagination && "onPageChange" in pagination) {
    page = pagination.page;
    totalPages = pagination.totalPages || 1;
    goTo = pagination.onPageChange;
  } else if (pagination) {
    totalPages = Math.max(1, Math.ceil(count / pagination.pageSize));
    page = Math.min(clientPage, totalPages);
    goTo = setClientPage;
    visible = visible.slice(
      (page - 1) * pagination.pageSize,
      page * pagination.pageSize,
    );
  }

  // Expandir ou recolher todas as linhas visíveis de uma vez; as de outras páginas ficam como estão.
  const allExpanded = visible.length > 0 && visible.every((row) => isExpanded(getRowId(row)));
  const toggleAll = () =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      // Alternada = diferente do padrão (`defaultExpanded` ou expandida pela busca).
      const toggled = !allExpanded !== (defaultExpanded || expandedBySearch);
      for (const row of visible) {
        if (toggled) next.add(getRowId(row));
        else next.delete(getRowId(row));
      }
      return next;
    });
  const toggleAllLabel = allExpanded ? "Recolher todas" : "Expandir todas";
  const toggleAllButton = (mobile: boolean) =>
    mobile ? (
      <Button variant="outline" size="default" onClick={toggleAll} disabled={visible.length === 0}>
        {allExpanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
        {toggleAllLabel}
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="icon"
        aria-label={`${toggleAllLabel} as linhas`}
        title={toggleAllLabel}
        onClick={toggleAll}
        disabled={visible.length === 0}
      >
        {allExpanded ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
      </Button>
    );

  const handleSort = (key: string) => {
    const first = columns.find((c) => c.key === key)?.firstSort ?? "asc";
    const opposite = first === "asc" ? "desc" : "asc";
    if (sortKey !== key) {
      setSortKey(key);
      setOrder(first);
      onSortChange?.(key, first);
    } else if (order === first) {
      setOrder(opposite);
      onSortChange?.(key, opposite);
    } else {
      setSortKey(undefined);
      onSortChange?.(key, null);
    }
  };

  const MIN_COLUMN_WIDTH = 60;
  const storageKey = resizeKey ? `celestia:datatable-widths:${resizeKey}` : undefined;
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (!storageKey) return {};
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      return saved && typeof saved === "object" ? (saved as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  const cardRef = useRef<HTMLDivElement>(null);
  const cssVar = (key: string) => `--cw-${key.replace(/[^\w-]/g, "_")}`;
  const canResize = (col: DataTableColumn<TRow>) => resizableColumns && col.resizable !== false;
  /** A largura vem de uma variável CSS no Card: arrastar só troca a variável, sem redesenhar linhas. */
  const widthStyle = (col: DataTableColumn<TRow>): React.CSSProperties | undefined =>
    canResize(col) ? { width: `var(${cssVar(col.key)})`, minWidth: `var(${cssVar(col.key)})`, maxWidth: `var(${cssVar(col.key)})` } : undefined;
  const widthVars = Object.fromEntries(Object.entries(colWidths).map(([k, w]) => [cssVar(k), `${w}px`])) as React.CSSProperties;
  const persistWidths = (next: Record<string, number>) => {
    setColWidths(next);
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // sem armazenamento: as larguras valem só nesta sessão.
    }
  };
  const startResize = (e: React.PointerEvent<HTMLElement>, col: DataTableColumn<TRow>) => {
    e.preventDefault();
    e.stopPropagation();
    const card = cardRef.current;
    const th = e.currentTarget.parentElement;
    if (!card || !th) return;
    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;
    let width = startWidth;
    const move = (ev: PointerEvent) => {
      width = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + ev.clientX - startX));
      card.style.setProperty(cssVar(col.key), `${width}px`);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      persistWidths({ ...colWidths, [col.key]: width });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const resetWidth = (col: DataTableColumn<TRow>) => {
    cardRef.current?.style.removeProperty(cssVar(col.key));
    const { [col.key]: _removed, ...rest } = colWidths;
    persistWidths(rest);
  };
  const resizeHandle = (col: DataTableColumn<TRow>) =>
    canResize(col) ? (
      <span
        aria-hidden
        data-resize-handle={col.key}
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30"
        onPointerDown={(e) => startResize(e, col)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          resetWidth(col);
        }}
      />
    ) : null;

  const hasActions = Boolean(rowActions);
  const primaryCol =
    columns.find((c) => c.mobileRole === "primary") ?? columns[0];
  const secondaryCol = columns.find((c) => c.mobileRole === "secondary");
  const fieldCols = columns.filter(
    (c) => c !== primaryCol && c !== secondaryCol && c.mobileRole !== "hidden",
  );
  const cellContent = (col: DataTableColumn<TRow>, row: TRow) =>
    col.render ? col.render(row) : text(col, row);
  /** Comparação no MobileCard; a impressão usa só `cellContent`. */
  const mobileCell = (col: DataTableColumn<TRow>, row: TRow) => {
    const trend = cellTrend(col, row);
    if (!trend) return cellContent(col, row);
    return (
      <span className="flex flex-col gap-0.5">
        {cellContent(col, row)}
        <TrendLine trend={trend} showPrevious />
      </span>
    );
  };
  const boundaries = groupBoundaryKeys(columns);
  /** Comparação de um total; a primeira coluna só tem o rótulo "Total". */
  const totalTrend = (
    col: DataTableColumn<TRow>,
    index: number,
  ): Trend | undefined => {
    const current = totalsValues?.[col.key];
    const compared = totalsCompare?.[col.key];
    if (
      index === 0 ||
      !compared ||
      typeof current !== "number" ||
      !isNumericFormat(col.format)
    )
      return undefined;
    return { ...compared, current, format: col.format };
  };

  const footer = pagination && goTo && (
    <div
      className={cn(
        "flex items-center justify-between border-t border-border",
        isMobile ? "pt-3" : "py-4",
      )}
    >
      <span className="text-xs text-muted-foreground">
        Página {page} de {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="default"
          disabled={page <= 1}
          onClick={() => goTo(Math.max(1, page - 1))}
        >
          <ChevronLeft className="size-4 mr-1" />
          Anterior
        </Button>
        <Button
          variant="outline"
          size="default"
          disabled={page >= totalPages}
          onClick={() => goTo(page + 1)}
        >
          Próxima
          <ChevronRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );

  const heading = typeof title === "function" ? title(count) : title;
  const serverPaged =
    manual && pagination !== undefined && "onPageChange" in pagination;

  const printButton = print && (
    <Button
      variant="outline"
      size="default"
      disabled={loading || count === 0 || serverPaged}
      onClick={async () => {
        if (print.prepare && !(await print.prepare())) return;
        setPrinting(true);
      }}
    >
      <Printer className="size-4 mr-1" />
      Imprimir
    </Button>
  );

  // `measure`: só as células do cabeçalho real medem as colunas fixas; a cópia grudada não.
  const partColumns = (part: "all" | "frozen" | "rest") =>
    part === "frozen" ? columns.slice(0, frozenCount) : part === "rest" ? columns.slice(frozenCount) : columns;
  const headerRows = (measure: boolean, part: "all" | "frozen" | "rest" = "all") => (
    <>
                  <GroupHeaderRow
                    columns={partColumns(part)}
                    force={part !== "all" && columns.some((c) => c.group)}
                    leading={renderExpanded && part !== "rest" ? 1 : 0}
                    trailing={hasActions && part !== "frozen" ? 1 : 0}
                    frozenKeys={frozenKeys}
                    frozenHead={(firstKey, lastKey) => ({
                      style: frozenStyle(firstKey, true),
                      className: cn(
                        frozenClass(firstKey, true),
                        lastKey === lastFrozenKey && FROZEN_EDGE_CLASS,
                      ),
                    })}
                  />
                  <TableRow className="bg-muted/40 border-b-0!">
                    {renderExpanded && part !== "rest" && (
                      <TableHead
                        ref={measure ? setHeadRef(EXPAND_KEY) : undefined}
                        style={frozenStyle(EXPAND_KEY, true)}
                        className={cn(
                          "w-12",
                          frozenClass(EXPAND_KEY, true),
                          HEADER_EDGE_CLASS,
                        )}
                      >
                        {!printing && toggleAllButton(false)}
                      </TableHead>
                    )}
                    {partColumns(part).map((col) => (
                      <TableHead
                        key={col.key}
                        ref={measure ? setHeadRef(col.key) : undefined}
                        style={{ ...frozenStyle(col.key, true), ...widthStyle(col) }}
                        className={cn(
                          canResize(col) && "relative",
                          col.sortable && "cursor-pointer select-none",
                          isNumericColumn(col) && "text-right",
                          isCenteredColumn(col) && "text-center",
                          hasFixedWidth(col) && FIXED_COLUMN_WIDTH_CLASS,
                          boundaryClass(col.key),
                          frozenClass(col.key, true),
                          headerEdgeClass(col.key),
                        )}
                        onClick={() => col.sortable && handleSort(col.key)}
                        aria-sort={
                          col.sortable && sortKey === col.key
                            ? order === "asc"
                              ? "ascending"
                              : "descending"
                            : undefined
                        }
                      >
                        {col.sortable ? (
                          <div
                            className={cn(
                              "flex items-center gap-1",
                              isNumericColumn(col) && "justify-end",
                              isCenteredColumn(col) && "justify-center",
                            )}
                          >
                            <HeaderLabel col={col} />
                            {sortKey === col.key ? (
                              order === "asc" ? (
                                <ArrowUp className="size-3" />
                              ) : (
                                <ArrowDown className="size-3" />
                              )
                            ) : (
                              <ArrowUpDown className="size-3 text-muted-foreground" />
                            )}
                          </div>
                        ) : (
                          <HeaderLabel col={col} />
                        )}
                        {resizeHandle(col)}
                      </TableHead>
                    ))}
                    {hasActions && part !== "frozen" && (
                      <TableHead
                        className={cn(actionsHeadClassName, HEADER_EDGE_CLASS)}
                      >
                        {actionsLabel}
                      </TableHead>
                    )}
                  </TableRow>
    </>
  );

  // Dentro da linha expandida de outra tabela: sem a moldura do Card (borda, fundo e respiro), para não empilhar cards.
  // `overflow-visible`: sem o respiro, o corte do Card esconderia a borda (`ring`, desenhada por fora) dos cards dos itens.
  return (
    <Card ref={cardRef} style={widthVars} className={cn(compact && "[&_td]:px-2 [&_td]:py-0.5 [&_td]:text-[13px] [&_th]:h-8 [&_th]:text-[13px]", scroll === "page" && "overflow-clip", scroll === "fill" && "@4xl:h-full @4xl:min-h-0", nested && "overflow-visible py-0 ring-0 bg-transparent", className)}>
      {(heading || description || search || print || headerActions) && (
        <CardHeader className="flex flex-col gap-4 @2xl:flex-row @2xl:items-center @2xl:justify-between">
          <div>
            {heading && (
              <CardTitle className="text-base font-semibold">
                {heading}
              </CardTitle>
            )}
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {description}
              </p>
            )}
          </div>
          {(search || printButton || headerActions) && (
            <div
              className={cn("flex items-center gap-2", isMobile && "w-full")}
            >
              {headerActions}
              {printButton}
              {search && (
                <InputGroup
                  className={
                    isMobile ? "flex-1" : (search.className ?? "min-w-72")
                  }
                  style={
                    isMobile || search.className
                      ? undefined
                      : {
                          // Cresce até caber o placeholder inteiro, sem cortar.
                          width: `calc(${(search.placeholder ?? "Buscar...").length}ch + 3rem)`,
                        }
                  }
                >
                  <InputGroupInput
                    type="search"
                    placeholder={search.placeholder ?? "Buscar..."}
                    value={query}
                    onChange={(e) => {
                      const searching = e.target.value.trim() !== "";
                      if (renderExpanded && !defaultExpanded && searching !== expandedBySearch) {
                        if (!searching || rows.every((row) => !isExpanded(getRowId(row)))) {
                          setExpandedBySearch(searching);
                          setExpandedIds(new Set());
                        }
                      }
                      setQuery(e.target.value);
                      setClientPage(1);
                      onSearchChange?.(e.target.value);
                    }}
                  />
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                </InputGroup>
              )}
            </div>
          )}
        </CardHeader>
      )}
      <CardContent className={cn(nested && "px-0", scroll === "fill" && "@4xl:flex @4xl:min-h-0 @4xl:flex-1 @4xl:flex-col")}>
        {isMobile ? (
          <div className="flex flex-col gap-3">
            {renderExpanded && !loading && visible.length > 0 && (
              <div className="flex justify-end">{toggleAllButton(true)}</div>
            )}
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, idx) => (
                <MobileCard
                  key={idx}
                  primary=""
                  secondary=""
                  fields={fieldCols.map((c) => ({
                    label: mobileLabel(c),
                    value: (
                      <Skeleton className={c.skeletonClassName ?? "h-4 w-20"} />
                    ),
                  }))}
                />
              ))
            ) : visible.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">
                {emptyMessage}
              </p>
            ) : (
              visible.map((row) => (
                <MobileCard
                  key={getRowId(row)}
                  primary={text(primaryCol, row)}
                  secondary={secondaryCol ? text(secondaryCol, row) : undefined}
                  fields={fieldCols.map((c) => ({
                    label: mobileLabel(c),
                    value: mobileCell(c, row),
                    wide: c.mobileWide,
                  }))}
                  actions={rowActions?.(row)}
                  expand={renderExpanded ? mobileExpandButton(row) : undefined}
                  details={
                    renderExpanded && isExpanded(getRowId(row)) ? (
                      <NestedTableContext.Provider value={true}>
                        {renderExpanded(row)}
                      </NestedTableContext.Provider>
                    ) : undefined
                  }
                />
              ))
            )}
            {totalsValues && !loading && visible.length > 0 && (
              <MobileCard
                primary={TOTAL_LABEL}
                fields={fieldCols
                  .filter((c) => c.key in totalsValues)
                  .map((c) => {
                    const trend = totalTrend(c, columns.indexOf(c));
                    const value = formatValue(totalsValues[c.key], c.format);
                    return {
                      label: mobileLabel(c),
                      value: trend ? (
                        <span className="flex flex-col gap-0.5">
                          {value}
                          <TrendLine trend={trend} showPrevious />
                        </span>
                      ) : (
                        value
                      ),
                    };
                  })}
              />
            )}
            {footer}
          </div>
        ) : (
          <>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard/focus delegation container for arrow navigation across the real inputs inside the rows. */}
            <div className={cn(bordered && "border border-border", rowCursor && "outline-none", scroll === "fill" && "@4xl:flex @4xl:min-h-0 @4xl:flex-1 @4xl:flex-col")} style={wide && HEAD_FOLLOWS_SCROLL ? ({ timelineScope: HEAD_TIMELINE } as React.CSSProperties) : undefined} data-arrow-root={arrowNavigation ? "" : undefined}
              ref={cursorRootRef}
              tabIndex={rowCursor ? -1 : undefined}
              onKeyUp={rowCursor && onRowToggle ? (e) => e.key === " " && !(e.target as Element).closest("input, textarea, select") && e.preventDefault() : undefined}
              onKeyDown={arrowNavigation || rowCursor ? (e) => { handleRowCursorKey(e); if (arrowNavigation && !e.defaultPrevented) handleArrowNavigation(e); } : undefined}
              onFocus={
                arrowNavigation
                  ? (e) => {
                      handleArrowNavigationFocus(e);
                      // Campo da linha com foco: a linha fica destacada como se tivesse sido clicada (não a de uma tabela aninhada).
                      const target = e.target as Element;
                      const tr = target.matches("input, textarea") ? target.closest("tr[data-row-id]") : null;
                      if (tr && tr.closest("[data-arrow-root]") === e.currentTarget) setSelectedId(tr.getAttribute("data-row-id"));
                    }
                  : undefined
              }>
              {wide && HEAD_FOLLOWS_SCROLL && <style>{HEAD_SCROLL_KEYFRAMES}</style>}
              {wide && (
                <div
                  ref={stickyHeadRef}
                  aria-hidden
                  className="sticky top-(--table-sticky-top,0px) z-10 flex overflow-hidden bg-background"
                >
                  {frozenCount > 0 && (
                    <div className="z-20 shrink-0 bg-background">
                      <table className="caption-bottom text-xs table-fixed" style={{ width: wide.columnWidths.slice(0, frozenCells).reduce((a, w) => a + w, 0) }}>
                        <colgroup>
                          {wide.columnWidths.slice(0, frozenCells).map((w, idx) => (
                            <col key={idx} style={{ width: w }} />
                          ))}
                        </colgroup>
                        <TableHeader className="static">{headerRows(false, "frozen")}</TableHeader>
                      </table>
                    </div>
                  )}
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <table
                      className="caption-bottom text-xs table-fixed"
                      style={
                        HEAD_FOLLOWS_SCROLL
                          ? ({
                              width: wide.columnWidths.slice(frozenCells).reduce((a, w) => a + w, 0),
                              "--head-max": `${wide.maxScroll}px`,
                              animation: "celestia-head-x linear both",
                              animationTimeline: HEAD_TIMELINE,
                            } as React.CSSProperties)
                          : { width: wide.columnWidths.slice(frozenCells).reduce((a, w) => a + w, 0) }
                      }
                    >
                      <colgroup>
                        {wide.columnWidths.slice(frozenCells).map((w, idx) => (
                          <col key={idx} style={{ width: w }} />
                        ))}
                      </colgroup>
                      <TableHeader className="static">{headerRows(false, frozenCount > 0 ? "rest" : "all")}</TableHeader>
                    </table>
                  </div>
                </div>
              )}
              <Table
                containerRef={containerRef}
                onContainerScroll={
                  wide || virtualOn
                    ? (e) => {
                        if (wide) syncScroll(e);
                        if (virtualOn) setStartIdx(Math.floor(e.currentTarget.scrollTop / rowH));
                      }
                    : undefined
                }
                containerStyle={
                  wide
                    ? ({
                        marginTop: -wide.headHeight,
                        ...(HEAD_FOLLOWS_SCROLL ? { scrollTimeline: `${HEAD_TIMELINE} x` } : null),
                      } as React.CSSProperties)
                    : undefined
                }
                containerClassName={
                  scroll === "page"
                    ? cn(
                        "max-h-none!",
                        pageScroll && "overflow-visible!",
                        wide && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                      )
                    : scroll === "fill"
                      ? "@4xl:min-h-0 @4xl:flex-1 @4xl:max-h-none"
                      : undefined
                }
              >
                <TableHeader
                  ref={headRef}
                  className={cn(
                    nested && pageScroll ? "static" : pageScroll ? PAGE_STICKY_HEAD_CLASS : undefined,
                    // A cópia grudada é o cabeçalho visível; o real só mede as colunas e nunca aparece junto com ela.
                    wide && "invisible",
                  )}
                >
                  {headerRows(true)}
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: skeletonRows }).map((_, idx) => (
                      <TableRow key={idx}>
                        {renderExpanded && <TableCell />}
                        {columns.map((c) => (
                          <TableCell key={c.key}>
                            <Skeleton
                              className={c.skeletonClassName ?? "h-4 w-full"}
                            />
                          </TableCell>
                        ))}
                        {hasActions && (
                          <TableCell className="text-center">
                            <Skeleton className={actionsSkeletonClassName} />
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  ) : visible.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={
                          columns.length +
                          (hasActions ? 1 : 0) +
                          (renderExpanded ? 1 : 0)
                        }
                        className="text-center py-10 text-muted-foreground"
                      >
                        {emptyMessage}
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                    {winStart > 0 && <VirtualSpacer height={winStart * rowH} span={columns.length + (hasActions ? 1 : 0)} />}
                    {(virtualOn ? visible.slice(winStart, winEnd) : visible).map((row) => {
                      const id = getRowId(row);
                      const expanded =
                        renderExpanded !== undefined && isExpanded(id);
                      const selected = selectedId === id;
                      return (
                        <MemoRow
                          key={id}
                          deps={[row, selected, expanded, columns, colWidths, frozenUntil, frozenLeft, striped, rowActions, renderExpanded, getRowId, highlightRow?.(row)]}
                          render={() => (
                        <React.Fragment>
                          <TableRow
                            data-row-id={id}
                            data-highlight={highlightRow?.(row) ? "true" : undefined}
                            data-state={selected ? "selected" : undefined}
                            aria-selected={selected}
                            onClick={(e) => {
                              if ((e.target as Element).closest(INTERACTIVE_SELECTOR)) return;
                              // Arrastou para selecionar texto (copiar): não é um clique na linha.
                              if (window.getSelection()?.toString()) return;
                              setSelectedId(rowCursor || !selected ? id : null);
                              // Linha expansível: o clique em qualquer ponto dela também expande/recolhe.
                              if (renderExpanded) toggleExpanded(id);
                            }}
                            className={cn(
                              // Sem transição: o fundo da linha e o das células fixas trocam juntos, na hora.
                              // Hover: o azul do destaque da linha selecionada, mais claro.
                              "group/row transition-none hover:bg-primary/5",
                              renderExpanded && "cursor-pointer",
                              striped && "even:bg-muted/20",
                              HIGHLIGHT_ROW_CLASS,
                              SELECTED_ROW_CLASS,
                            )}
                          >
                            {renderExpanded && (
                              <TableCell
                                style={frozenStyle(EXPAND_KEY)}
                                className={cn(frozenClass(EXPAND_KEY))}
                              >
                                {expandButton(row)}
                              </TableCell>
                            )}
                            {columns.map((col) => {
                              const trend = cellTrend(col, row);
                              const cell = (
                                <TableCell
                                  key={col.key}
                                  style={{ ...frozenStyle(col.key), ...widthStyle(col) }}
                                  className={cn(
                                    columnCellClassName(col, row),
                                    colWidths[col.key] !== undefined && canResize(col) && "overflow-hidden text-ellipsis",
                                    boundaryClass(col.key),
                                    frozenClass(col.key),
                                    col.key === lastFrozenKey &&
                                      FROZEN_EDGE_CLASS,
                                    trend && "cursor-help",
                                  )}
                                >
                                  {col.truncateAt && !col.render ? (
                                    <span
                                      className="block truncate"
                                      style={{ maxWidth: `${col.truncateAt}ch` }}
                                      title={String(col.value?.(row) ?? "") || undefined}
                                    >
                                      {cellContent(col, row)}
                                    </span>
                                  ) : (
                                    cellContent(col, row)
                                  )}
                                </TableCell>
                              );
                              // A célula inteira é o gatilho do tooltip compartilhado da tabela.
                              return trend ? (
                                <TrendTooltipTrigger
                                  key={col.key}
                                  handle={trendTooltip}
                                  trend={trend}
                                  title={mobileLabel(col)}
                                >
                                  {cell}
                                </TrendTooltipTrigger>
                              ) : (
                                cell
                              );
                            })}
                            {hasActions && (
                              <TableCell className="text-center">
                                {rowActions?.(row)}
                              </TableCell>
                            )}
                          </TableRow>
                          {expanded && (
                            <TableRow>
                              <TableCell
                                colSpan={
                                  columns.length + (hasActions ? 1 : 0) + 1
                                }
                              >
                                <NestedTableContext.Provider value={true}>
                                  {renderExpanded(row)}
                                </NestedTableContext.Provider>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                          )}
                        />
                      );
                    })}
                    {virtualOn && winEnd < count && <VirtualSpacer height={(count - winEnd) * rowH} span={columns.length + (hasActions ? 1 : 0)} />}
                    </>
                  )}
                </TableBody>
                {totalsValues && !loading && visible.length > 0 && (
                  <TableFooter className={TOTALS_CLASS}>
                    <TableRow>
                      {renderExpanded && (
                        <TableCell
                          style={frozenStyle(EXPAND_KEY)}
                          className={cn(frozenClass(EXPAND_KEY, true))}
                        />
                      )}
                      {columns.map((col, idx) => {
                        const trend = totalTrend(col, idx);
                        const cell = (
                          <TableCell
                            key={col.key}
                            style={frozenStyle(col.key)}
                            className={cn(
                              totalsCellClassName(col),
                              boundaryClass(col.key),
                              frozenClass(col.key, true),
                              col.key === lastFrozenKey && FROZEN_EDGE_CLASS,
                              trend && "cursor-help",
                            )}
                          >
                            {totalCellText(col, idx, totalsValues)}
                          </TableCell>
                        );
                        return trend ? (
                          <TrendTooltipTrigger
                            key={col.key}
                            handle={trendTooltip}
                            trend={trend}
                            title={mobileLabel(col)}
                          >
                            {cell}
                          </TrendTooltipTrigger>
                        ) : (
                          cell
                        );
                      })}
                      {hasActions && <TableCell />}
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
              {wide && (
                <div
                  ref={scrollbarRef}
                  onScroll={syncScroll}
                  aria-hidden
                  className="sticky bottom-0 z-10 overflow-x-auto overflow-y-hidden bg-background"
                >
                  <div className="h-px" style={{ width: wide.tableWidth }} />
                </div>
              )}
            </div>
            <SharedTrendTooltip handle={trendTooltip} />
            {footer}
          </>
        )}
      </CardContent>
      {print && printing && (
        <PrintTable
          columns={print.columns ?? columns}
          rows={printRows}
          totals={totalsValues}
          getRowId={getRowId}
          cellContent={(col, row) => (col.printValue ? col.printValue(row) : cellContent(col, row))}
          striped={striped}
          bordered={bordered}
          lastFrozenKey={lastFrozenKey}
          title={heading}
          fileName={print.fileName ?? heading}
          description={print.description ?? description}
          orientation={print.orientation ?? "portrait"}
          details={print.details}
          onDone={endPrinting}
        />
      )}
    </Card>
  );
}

/** Subtabela compacta para `print.details`: texto pequeno, sem card, com os valores formatados como na tabela. */
export function PrintDetailTable<TRow>({
  columns,
  rows,
  getRowId,
}: {
  columns: DataTableColumn<TRow>[];
  rows: TRow[];
  getRowId: (row: TRow) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <table className={cn("w-full text-[9px] border-l", PRINT_LINE_COLOR)}>
      <thead>
        <tr className="text-muted-foreground">
          {columns.map((col) => (
            <th
              key={col.key}
              className={cn(
                "px-1.5 py-0.5 font-medium text-left",
                isNumericColumn(col) && "text-right",
                isCenteredColumn(col) && "text-center",
              )}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={getRowId(row)}>
            {columns.map((col) => (
              <td
                key={col.key}
                className={cn(
                  "px-1.5 py-0.5 whitespace-normal",
                  isNumericColumn(col) && "text-right",
                  isCenteredColumn(col) && "text-center",
                )}
              >
                {formatValue(col.value?.(row), col.format)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const PAGE_WIDTH_MM = { portrait: 210, landscape: 297 } as const;
const PAGE_MARGIN_MM = 10;
const PX_PER_MM = 96 / 25.4;

function issuedAtLabel(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

interface PrintTableProps<TRow> {
  columns: DataTableColumn<TRow>[];
  rows: TRow[];
  totals?: TotalsValues;
  getRowId: (row: TRow) => string;
  cellContent: (col: DataTableColumn<TRow>, row: TRow) => React.ReactNode;
  striped: boolean;
  bordered: boolean;
  /** Última coluna fixa na tela; no papel vira uma divisória, para a leitura ficar igual. */
  lastFrozenKey?: string;
  title?: string;
  fileName?: string;
  description?: string;
  orientation: DataTablePrintOrientation;
  /** Detalhes impressos abaixo de cada linha (as linhas expandidas). */
  details?: (row: TRow) => React.ReactNode;
  onDone: () => void;
}

/**
 * Versão só para impressão, montada ao clicar em "Imprimir" e desmontada no `afterprint`.
 * Fica fora da tela (invisível) até a impressão; no papel, esconde o resto do `body`.
 * Antes de imprimir, mede a largura mínima da tabela e aplica `zoom` só nela para caber na folha.
 */
function PrintTable<TRow>({
  columns,
  rows,
  totals,
  getRowId,
  cellContent,
  striped,
  bordered,
  lastFrozenKey,
  title,
  fileName,
  description,
  orientation,
  details,
  onDone,
}: PrintTableProps<TRow>) {
  const boundaries = groupBoundaryKeys(columns);
  const frozenEdge = (key: string) =>
    key === lastFrozenKey && cn("border-r-2", PRINT_LINE_COLOR);
  const frozenKeys = columns
    .slice(0, columns.findIndex((c) => c.key === lastFrozenKey) + 1)
    .map((c) => c.key);
  const tableRef = useRef<HTMLTableElement>(null);
  const printed = useRef(false);
  const [issuedAt] = useState(() => issuedAtLabel(new Date()));
  const pageWidth = Math.floor(
    (PAGE_WIDTH_MM[orientation] - 2 * PAGE_MARGIN_MM) * PX_PER_MM,
  );
  const [fit, setFit] = useState<{ width?: number; zoom: number } | null>(null);

  useLayoutEffect(() => {
    const tableWidth = tableRef.current?.offsetWidth ?? 0;
    setFit(
      tableWidth > pageWidth
        ? { width: tableWidth, zoom: pageWidth / tableWidth }
        : { zoom: 1 },
    );
  }, [pageWidth]);

  // O "Salvar como PDF" do navegador sugere o título da página como nome do arquivo.
  useEffect(() => {
    if (!fileName) return;
    const previous = document.title;
    document.title = fileName;
    return () => {
      document.title = previous;
    };
  }, [fileName]);

  useEffect(() => {
    if (!fit) return;
    window.addEventListener("afterprint", onDone);
    // Guarda contra o efeito duplicado do StrictMode, que abriria a impressão duas vezes.
    if (!printed.current) {
      printed.current = true;
      window.print();
    }
    return () => window.removeEventListener("afterprint", onDone);
  }, [fit, onDone]);

  const css = `@media print {
  @page {
    size: A4 ${orientation};
    margin: ${PAGE_MARGIN_MM}mm ${PAGE_MARGIN_MM}mm 14mm;
    @bottom-left { content: "Emitido em ${issuedAt}"; font-size: 8pt; color: #555; }
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8pt; color: #555; }
  }
  body > :not([data-slot="data-table-print"]) { display: none !important; }
  [data-slot="data-table-print"] { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  /* Papel em preto: os tons de destaque da tela (verde, cinza) não carregam sentido impressos. */
  [data-slot="data-table-print"] td, [data-slot="data-table-print"] td * { color: #000 !important; }
  /* Linhas visíveis no papel: o tom da tela some na impressão. */
  [data-slot="data-table-print"] tr { border-color: #9ca3af !important; }
  /* A borda da linha vai na célula: com um tbody por linha, a do tr some no papel em alguns navegadores. */
  [data-slot="data-table-print"] tbody td { border-bottom: 1px solid #6b7280 !important; }
  [data-slot="data-table-print"] input { border-color: #9ca3af !important; background: transparent !important; }
}`;

  return createPortal(
    <div
      data-slot="data-table-print"
      className="invisible fixed top-0 left-0 -z-10 bg-background text-foreground print:visible print:static print:z-auto"
      style={{ width: pageWidth }}
    >
      <style>{css}</style>
      <div className="mb-3">
        {title && <h1 className="text-base font-semibold">{title}</h1>}
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {/* `<table>` direto: o container do `<Table>` tem overflow/max-height e cortaria o papel numa altura de tela. */}
      <table
        ref={tableRef}
        aria-label={title ?? "Impressão"}
        className={cn(
          "w-full caption-bottom text-[10px]",
          bordered && cn("border", PRINT_LINE_COLOR),
        )}
        style={{ width: fit?.width, zoom: fit?.zoom ?? 1 }}
      >
        <TableHeader className="static">
          <GroupHeaderRow
            columns={columns}
            frozenKeys={frozenKeys}
            frozenHead={(_firstKey, lastKey) => ({
              className: frozenEdge(lastKey),
            })}
          />
          <TableRow className={cn("bg-muted/40 border-b-2!", PRINT_LINE_COLOR)}>
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  "h-8 text-xs font-semibold",
                  wrapsInPrint(col) && "whitespace-normal",
                  isNumericColumn(col) && "text-right",
                  isCenteredColumn(col) && "text-center",
                  boundaries.has(col.key) && GROUP_BOUNDARY_CLASS,
                  frozenEdge(col.key),
                )}
              >
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        {/* Um `<tbody>` por linha: com o detalhe, a linha e o detalhe não se separam entre páginas. */}
        {rows.map((row) => {
            const detalhe = details?.(row);
            return (
              <TableBody key={getRowId(row)} className="break-inside-avoid">
                <TableRow
                  className={cn(
                    "break-inside-avoid",
                    striped && "even:bg-muted/30",
                  )}
                >
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn(
                        "p-1.5",
                        wrapsInPrint(col) && "whitespace-normal",
                        columnCellClassName(col, row),
                        boundaries.has(col.key) && GROUP_BOUNDARY_CLASS,
                        frozenEdge(col.key),
                      )}
                    >
                      {cellContent(col, row)}
                    </TableCell>
                  ))}
                </TableRow>
                {detalhe && (
                  <TableRow className="break-inside-avoid">
                    <TableCell
                      colSpan={columns.length}
                      className="p-0 pb-1.5 pl-6 whitespace-normal"
                    >
                      {detalhe}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            );
          })}
        {totals && rows.length > 0 && (
          // `table-row-group`: um `<tfoot>` comum se repete em toda folha; assim o total sai só depois da última linha.
          <TableFooter className={cn(TOTALS_CLASS, "table-row-group")}>
            <TableRow className="break-inside-avoid">
              {columns.map((col, idx) => (
                <TableCell
                  key={col.key}
                  className={cn(
                    "p-1.5",
                    totalsCellClassName(col),
                    boundaries.has(col.key) && GROUP_BOUNDARY_CLASS,
                    frozenEdge(col.key),
                  )}
                >
                  {totalCellText(col, idx, totals)}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </table>
    </div>,
    document.body,
  );
}
