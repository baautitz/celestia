import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, Printer, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { Button } from "../components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/input-group";
import { MobileCard } from "../components/mobile-card";
import { Skeleton } from "../components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
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
import { formatCurrency, formatDate, formatDecimal, formatNumber, formatPercent } from "../lib/format";

export type CellValue = string | number | boolean | null | undefined;
export type DataTableFormat = "currency" | "date" | "decimal" | "number" | "percent";

const NUMERIC_FORMATS: ReadonlySet<DataTableFormat | undefined> = new Set<TrendFormat>(["currency", "decimal", "number", "percent"]);
const isNumericFormat = (format?: DataTableFormat): format is TrendFormat => NUMERIC_FORMATS.has(format);
const isNumericColumn = (col: { format?: DataTableFormat }) => isNumericFormat(col.format);
/** Colunas que não quebram linha na impressão; as demais quebram para a tabela encolher menos. */
const NOWRAP_PRINT_FORMATS: ReadonlySet<DataTableFormat | undefined> = new Set([...NUMERIC_FORMATS, "date"]);
const wrapsInPrint = (col: { format?: DataTableFormat; nowrap?: boolean }) =>
  !col.nowrap && !NOWRAP_PRINT_FORMATS.has(col.format);

function HeaderLabel({ col }: { col: { label: string; tooltip?: string } }) {
  if (!col.tooltip) return <span>{col.label}</span>;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-help">{col.label}</span>} />
      <TooltipContent>{col.tooltip}</TooltipContent>
    </Tooltip>
  );
}

export interface DataTableColumn<TRow> {
  key: string;
  label: string;
  /** Explicação exibida em tooltip ao passar o mouse sobre o cabeçalho. */
  tooltip?: string;
  /** Rótulo do campo no MobileCard; padrão: `label`, prefixado pelo `group`. */
  mobileLabel?: string;
  /** Rótulo de um cabeçalho acima do `label`, mesclado entre colunas vizinhas do mesmo grupo. */
  group?: string;
  /** Mantém o conteúdo numa linha só, também na impressão (ex.: nomes que encareceriam a altura da linha). */
  nowrap?: boolean;
  /** Valor bruto da célula; usado para formato, busca, ordenação e título do MobileCard. */
  value?: (row: TRow) => CellValue;
  /** Conteúdo customizado (badges etc.); tem precedência sobre `value`/`format` na célula. */
  render?: (row: TRow) => React.ReactNode;
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
  /**
   * Valor anterior da célula (ex.: o mesmo Colaborador no Período anterior); `undefined` = sem comparação.
   * Tooltip no desktop, linha abaixo do valor no MobileCard e nada na impressão. Requer `value` numérico.
   */
  compare?: (row: TRow) => Pick<Trend, "previous" | "label" | "favorable"> | undefined;
}

export type DataTablePagination =
  | { pageSize: number }
  | { page: number; totalPages: number; onPageChange: (page: number) => void };

export type DataTablePrintOrientation = "portrait" | "landscape";

export interface DataTablePrintOptions {
  /** Orientação da folha A4. Padrão: "portrait". */
  orientation?: DataTablePrintOrientation;
  /** Substitui `description` no papel (ex.: filtros ativos que a tela mostra fora da tabela). */
  description?: string;
  /** Nome sugerido ao salvar como PDF (vira o título da página durante a impressão). Padrão: `title`. */
  fileName?: string;
}

export interface DataTableProps<TRow> {
  columns: DataTableColumn<TRow>[];
  rows: TRow[];
  getRowId: (row: TRow) => string;
  loading?: boolean;
  skeletonRows?: number;
  /** Texto, ou função recebendo a quantidade de linhas após a busca. */
  title?: string | ((count: number) => string);
  description?: string;
  emptyMessage?: string;
  rowActions?: (row: TRow) => React.ReactNode;
  /** Detalhes da linha; quando informado, cada linha ganha um botão de expandir/recolher. */
  renderExpanded?: (row: TRow) => React.ReactNode;
  actionsLabel?: string;
  actionsHeadClassName?: string;
  actionsSkeletonClassName?: string;
  search?: { placeholder?: string; className?: string };
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
  print?: DataTablePrintOptions;
  /** Alterna o fundo das linhas, na tela e na impressão, para guiar a leitura de tabelas largas. */
  striped?: boolean;
  /** `key` da última coluna presa à esquerda na rolagem horizontal; ela e as anteriores ficam fixas. Não afeta a impressão. */
  frozenUntil?: string;
}
/** Chave da coluna do botão de expandir na medição das colunas fixas. */
const EXPAND_KEY = "__expand";

/** Fundos opacos (mistura sobre `--background`) para as células fixas não deixarem o conteúdo rolado aparecer por baixo. */
const FROZEN_HEAD_CLASS = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))]";
const FROZEN_CELL_CLASS =
  "bg-background group-hover/row:bg-[color-mix(in_oklab,var(--muted)_30%,var(--background))]";
const FROZEN_STRIPED_CELL_CLASS = "group-even/row:bg-[color-mix(in_oklab,var(--muted)_20%,var(--background))]";

/**
 * Linhas de 2px no fim do cabeçalho fixo e da última coluna fixa. Sombra interna em vez de borda:
 * com `border-collapse`, a borda de uma célula `sticky` fica para trás quando a tabela rola.
 */
const HEADER_EDGE_CLASS = "shadow-[inset_0_-2px_0_var(--border)]";
const FROZEN_EDGE_CLASS = "shadow-[inset_-2px_0_0_var(--border)]";
const FROZEN_HEADER_EDGE_CLASS = "shadow-[inset_-2px_-2px_0_var(--border)]";
/** No papel nada rola: as mesmas linhas da tela, como bordas comuns. */
const PRINT_LINE_COLOR = "border-border";

function mobileLabel(col: { label: string; mobileLabel?: string; group?: string }): string {
  return col.mobileLabel ?? (col.group ? `${col.group} · ${col.label}` : col.label);
}

/** Linha de cabeçalho com os grupos de colunas; não renderiza nada quando nenhuma coluna tem `group`. */
function GroupHeaderRow({
  columns,
  leading = 0,
  trailing = 0,
  frozenKeys = [],
  frozenHead,
}: {
  columns: { key: string; group?: string }[];
  leading?: number;
  trailing?: number;
  /** Colunas fixas: um grupo não se mescla por cima da fronteira entre fixas e roláveis. */
  frozenKeys?: readonly string[];
  /** Estilo e classes de uma célula fixa, pela chave da primeira e da última coluna que ela cobre. */
  frozenHead?: (firstKey: string, lastKey: string) => { style?: React.CSSProperties; className?: string | false };
}) {
  if (!columns.some((c) => c.group)) return null;
  const boundaries = groupBoundaryKeys(columns);
  const spans: { key: string; lastKey: string; group?: string; frozen: boolean; span: number }[] = [];
  for (const col of columns) {
    const last = spans[spans.length - 1];
    const frozen = frozenKeys.includes(col.key);
    if (last && last.group === col.group && last.frozen === frozen) {
      last.span++;
      last.lastKey = col.key;
    } else spans.push({ key: col.key, lastKey: col.key, group: col.group, frozen, span: 1 });
  }
  const leadingHead = frozenKeys.length > 0 ? frozenHead?.(EXPAND_KEY, EXPAND_KEY) : undefined;
  return (
    <TableRow className="bg-muted/40">
      {leading > 0 && <TableHead colSpan={leading} style={leadingHead?.style} className={cn(leadingHead?.className)} />}
      {spans.map(({ key, lastKey, group, frozen, span }) => {
        const head = frozen ? frozenHead?.(key, lastKey) : undefined;
        return (
          <TableHead
            key={key}
            colSpan={span}
            style={head?.style}
            className={cn("h-8", group && "text-center", boundaries.has(key) && GROUP_BOUNDARY_CLASS, head?.className)}
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
function groupBoundaryKeys(columns: { key: string; group?: string }[]): ReadonlySet<string> {
  const keys = new Set<string>();
  columns.forEach((col, i) => {
    const prev = columns[i - 1];
    if (prev && prev.group !== col.group && (prev.group || col.group)) keys.add(col.key);
  });
  return keys;
}

const GROUP_BOUNDARY_CLASS = "border-l border-border";

function columnCellClassName<TRow>(col: DataTableColumn<TRow>, row: TRow): string | undefined {
  return cn(
    isNumericColumn(col) && "text-right tabular-nums",
    col.nowrap && "whitespace-nowrap",
    typeof col.cellClassName === "function" ? col.cellClassName(row) : col.cellClassName,
  );
}

function cellTrend<TRow>(col: DataTableColumn<TRow>, row: TRow): Trend | undefined {
  const current = col.value?.(row);
  const compared = col.compare?.(row);
  if (!compared || typeof current !== "number" || !isNumericFormat(col.format)) return undefined;
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

export function DataTable<TRow>({
  columns,
  rows,
  getRowId,
  loading = false,
  skeletonRows = 4,
  title,
  description,
  emptyMessage = "Nenhum registro encontrado.",
  rowActions,
  renderExpanded,
  actionsLabel = "Ações",
  actionsHeadClassName = "text-right w-20",
  actionsSkeletonClassName = "h-8 w-8 ml-auto",
  search,
  pagination,
  manual = false,
  onSortChange,
  onSearchChange,
  bordered = false,
  className,
  print,
  striped = false,
  frozenUntil,
}: DataTableProps<TRow>) {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | undefined>(undefined);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [clientPage, setClientPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [printing, setPrinting] = useState(false);
  const trendTooltip = useTrendTooltipHandle();
  const endPrinting = useCallback(() => setPrinting(false), []);
  const headRefs = useRef(new Map<string, HTMLTableCellElement>());
  const [frozenLeft, setFrozenLeft] = useState<ReadonlyMap<string, number>>(new Map());

  const frozenCount = columns.findIndex((c) => c.key === frozenUntil) + 1;
  const frozenKeys = columns.slice(0, frozenCount).map((c) => c.key);
  const lastFrozenKey = frozenKeys[frozenKeys.length - 1];
  const frozenSignature = frozenKeys.join("|");

  // Cada coluna fixa fica à esquerda da soma das larguras das fixas anteriores (e do botão de expandir).
  useLayoutEffect(() => {
    const measure = () => {
      let left = headRefs.current.get(EXPAND_KEY)?.offsetWidth ?? 0;
      const next = new Map<string, number>();
      for (const key of frozenSignature ? frozenSignature.split("|") : []) {
        next.set(key, left);
        left += headRefs.current.get(key)?.offsetWidth ?? 0;
      }
      setFrozenLeft(next);
    };
    measure();
    if (!frozenSignature || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    headRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [frozenSignature, rows]);

  const frozenStyle = (key: string, head = false): React.CSSProperties | undefined =>
    frozenKeys.includes(key) || (key === EXPAND_KEY && frozenCount > 0)
      ? { position: "sticky", left: frozenLeft.get(key) ?? 0, zIndex: head ? 20 : 1 }
      : undefined;
  const frozenClass = (key: string, head = false) =>
    (frozenKeys.includes(key) || (key === EXPAND_KEY && frozenCount > 0)) &&
    cn(head ? FROZEN_HEAD_CLASS : cn(FROZEN_CELL_CLASS, striped && FROZEN_STRIPED_CELL_CLASS));
  /** Linha inferior do cabeçalho de colunas, que dobra como borda direita na última coluna fixa. */
  const headerEdgeClass = (key: string) => (key === lastFrozenKey ? FROZEN_HEADER_EDGE_CLASS : HEADER_EDGE_CLASS);
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
    const expanded = expandedIds.has(id);
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

  const text = (col: DataTableColumn<TRow>, row: TRow): string =>
    formatValue(col.value?.(row), col.format);

  let visible = rows;
  if (!manual) {
    const q = query.trim().toLowerCase();
    if (q) {
      visible = visible.filter((row) =>
        columns.some((c) => c.searchable && String(c.value?.(row) ?? "").toLowerCase().includes(q)),
      );
    }
    const sortCol = columns.find((c) => c.key === sortKey);
    if (sortCol?.value) {
      const get = sortCol.value;
      const dir = order === "asc" ? 1 : -1;
      visible = [...visible].sort((a, b) => {
        const x = get(a);
        const y = get(b);
        if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
        return String(x ?? "").localeCompare(String(y ?? ""), "pt-BR") * dir;
      });
    }
  }
  const count = visible.length;
  const printRows = visible;

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
    visible = visible.slice((page - 1) * pagination.pageSize, page * pagination.pageSize);
  }

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

  const hasActions = Boolean(rowActions);
  const primaryCol = columns.find((c) => c.mobileRole === "primary") ?? columns[0];
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
        <Button variant="outline" size="default" disabled={page <= 1} onClick={() => goTo(Math.max(1, page - 1))}>
          <ChevronLeft className="size-4 mr-1" />
          Anterior
        </Button>
        <Button variant="outline" size="default" disabled={page >= totalPages} onClick={() => goTo(page + 1)}>
          Próxima
          <ChevronRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );

  const heading = typeof title === "function" ? title(count) : title;
  const serverPaged = manual && pagination !== undefined && "onPageChange" in pagination;

  const printButton = print && (
    <Button
      variant="outline"
      size="default"
      disabled={loading || count === 0 || serverPaged}
      onClick={() => setPrinting(true)}
    >
      <Printer className="size-4 mr-1" />
      Imprimir
    </Button>
  );

  return (
    <Card className={className}>
      {(heading || description || search || print) && (
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            {heading && <CardTitle className="text-base font-semibold">{heading}</CardTitle>}
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {(search || printButton) && (
            <div className="flex items-center gap-2">
              {printButton}
              {search && (
                <InputGroup className={search.className ?? "w-72"}>
                  <InputGroupInput
                    type="search"
                    placeholder={search.placeholder ?? "Buscar..."}
                    value={query}
                    onChange={(e) => {
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
      <CardContent>
        {isMobile ? (
          <div className="flex flex-col gap-3">
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, idx) => (
                <MobileCard
                  key={idx}
                  primary=""
                  secondary=""
                  fields={fieldCols.map((c) => ({
                    label: mobileLabel(c),
                    value: <Skeleton className={c.skeletonClassName ?? "h-4 w-20"} />,
                  }))}
                />
              ))
            ) : visible.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">{emptyMessage}</p>
            ) : (
              visible.map((row) => (
                <MobileCard
                  key={getRowId(row)}
                  primary={text(primaryCol, row)}
                  secondary={secondaryCol ? text(secondaryCol, row) : undefined}
                  fields={fieldCols.map((c) => ({ label: mobileLabel(c), value: mobileCell(c, row) }))}
                  actions={
                    renderExpanded ? (
                      <>
                        {expandButton(row)}
                        {rowActions?.(row)}
                      </>
                    ) : (
                      rowActions?.(row)
                    )
                  }
                  details={renderExpanded && expandedIds.has(getRowId(row)) ? renderExpanded(row) : undefined}
                />
              ))
            )}
            {footer}
          </div>
        ) : (
          <>
            <div className={bordered ? "border border-border" : undefined}>
              <Table>
                <TableHeader>
                  <GroupHeaderRow
                    columns={columns}
                    leading={renderExpanded ? 1 : 0}
                    trailing={hasActions ? 1 : 0}
                    frozenKeys={frozenKeys}
                    frozenHead={(firstKey, lastKey) => ({
                      style: frozenStyle(firstKey, true),
                      className: cn(frozenClass(firstKey, true), lastKey === lastFrozenKey && FROZEN_EDGE_CLASS),
                    })}
                  />
                  <TableRow className="bg-muted/40 border-b-0!">
                    {renderExpanded && (
                      <TableHead
                        ref={setHeadRef(EXPAND_KEY)}
                        style={frozenStyle(EXPAND_KEY, true)}
                        className={cn("w-12", frozenClass(EXPAND_KEY, true), HEADER_EDGE_CLASS)}
                      />
                    )}
                    {columns.map((col) => (
                      <TableHead
                        key={col.key}
                        ref={setHeadRef(col.key)}
                        style={frozenStyle(col.key, true)}
                        className={cn(
                          col.sortable && "cursor-pointer select-none",
                          isNumericColumn(col) && "text-right",
                          boundaries.has(col.key) && GROUP_BOUNDARY_CLASS,
                          frozenClass(col.key, true),
                          headerEdgeClass(col.key),
                        )}
                        onClick={() => col.sortable && handleSort(col.key)}
                        aria-sort={col.sortable && sortKey === col.key ? (order === "asc" ? "ascending" : "descending") : undefined}
                      >
                        {col.sortable ? (
                          <div className={cn("flex items-center gap-1", isNumericColumn(col) && "justify-end")}>
                            <HeaderLabel col={col} />
                            {sortKey === col.key ? (
                              order === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                            ) : (
                              <ArrowUpDown className="size-3 text-muted-foreground" />
                            )}
                          </div>
                        ) : (
                          <HeaderLabel col={col} />
                        )}
                      </TableHead>
                    ))}
                    {hasActions && <TableHead className={cn(actionsHeadClassName, HEADER_EDGE_CLASS)}>{actionsLabel}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: skeletonRows }).map((_, idx) => (
                      <TableRow key={idx}>
                        {renderExpanded && <TableCell />}
                        {columns.map((c) => (
                          <TableCell key={c.key}>
                            <Skeleton className={c.skeletonClassName ?? "h-4 w-full"} />
                          </TableCell>
                        ))}
                        {hasActions && (
                          <TableCell className="text-right">
                            <Skeleton className={actionsSkeletonClassName} />
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  ) : visible.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={columns.length + (hasActions ? 1 : 0) + (renderExpanded ? 1 : 0)}
                        className="text-center py-10 text-muted-foreground"
                      >
                        {emptyMessage}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visible.map((row) => {
                      const expanded = renderExpanded !== undefined && expandedIds.has(getRowId(row));
                      return (
                        <React.Fragment key={getRowId(row)}>
                          <TableRow className={cn("group/row hover:bg-muted/30", striped && "even:bg-muted/20")}>
                            {renderExpanded && (
                              <TableCell style={frozenStyle(EXPAND_KEY)} className={cn(frozenClass(EXPAND_KEY))}>
                                {expandButton(row)}
                              </TableCell>
                            )}
                            {columns.map((col) => {
                              const trend = cellTrend(col, row);
                              const cell = (
                                <TableCell
                                  key={col.key}
                                  style={frozenStyle(col.key)}
                                  className={cn(
                                    columnCellClassName(col, row),
                                    boundaries.has(col.key) && GROUP_BOUNDARY_CLASS,
                                    frozenClass(col.key),
                                    col.key === lastFrozenKey && FROZEN_EDGE_CLASS,
                                    trend && "cursor-help",
                                  )}
                                >
                                  {cellContent(col, row)}
                                </TableCell>
                              );
                              // A célula inteira é o gatilho do tooltip compartilhado da tabela.
                              return trend ? (
                                <TrendTooltipTrigger key={col.key} handle={trendTooltip} trend={trend} title={mobileLabel(col)}>
                                  {cell}
                                </TrendTooltipTrigger>
                              ) : (
                                cell
                              );
                            })}
                            {hasActions && <TableCell className="text-right">{rowActions?.(row)}</TableCell>}
                          </TableRow>
                          {expanded && (
                            <TableRow>
                              <TableCell colSpan={columns.length + (hasActions ? 1 : 0) + 1}>
                                {renderExpanded(row)}
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            <SharedTrendTooltip handle={trendTooltip} />
            {footer}
          </>
        )}
      </CardContent>
      {print && printing && (
        <PrintTable
          columns={columns}
          rows={printRows}
          getRowId={getRowId}
          cellContent={cellContent}
          striped={striped}
          bordered={bordered}
          lastFrozenKey={lastFrozenKey}
          title={heading}
          fileName={print.fileName ?? heading}
          description={print.description ?? description}
          orientation={print.orientation ?? "portrait"}
          onDone={endPrinting}
        />
      )}
    </Card>
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
  getRowId,
  cellContent,
  striped,
  bordered,
  lastFrozenKey,
  title,
  fileName,
  description,
  orientation,
  onDone,
}: PrintTableProps<TRow>) {
  const boundaries = groupBoundaryKeys(columns);
  const frozenEdge = (key: string) => key === lastFrozenKey && cn("border-r-2", PRINT_LINE_COLOR);
  const frozenKeys = columns.slice(0, columns.findIndex((c) => c.key === lastFrozenKey) + 1).map((c) => c.key);
  const tableRef = useRef<HTMLTableElement>(null);
  const printed = useRef(false);
  const [issuedAt] = useState(() => issuedAtLabel(new Date()));
  const pageWidth = Math.floor((PAGE_WIDTH_MM[orientation] - 2 * PAGE_MARGIN_MM) * PX_PER_MM);
  const [fit, setFit] = useState<{ width?: number; zoom: number } | null>(null);

  useLayoutEffect(() => {
    const tableWidth = tableRef.current?.offsetWidth ?? 0;
    setFit(tableWidth > pageWidth ? { width: tableWidth, zoom: pageWidth / tableWidth } : { zoom: 1 });
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
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {/* `<table>` direto: o container do `<Table>` tem overflow/max-height e cortaria o papel numa altura de tela. */}
      <table
        ref={tableRef}
        aria-label={title ?? "Impressão"}
        className={cn("w-full caption-bottom text-[10px]", bordered && cn("border", PRINT_LINE_COLOR))}
        style={{ width: fit?.width, zoom: fit?.zoom ?? 1 }}
      >
        <TableHeader className="static">
          <GroupHeaderRow
            columns={columns}
            frozenKeys={frozenKeys}
            frozenHead={(_firstKey, lastKey) => ({ className: frozenEdge(lastKey) })}
          />
          <TableRow className={cn("bg-muted/40 border-b-2!", PRINT_LINE_COLOR)}>
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  "h-8",
                  wrapsInPrint(col) && "whitespace-normal",
                  isNumericColumn(col) && "text-right",
                  boundaries.has(col.key) && GROUP_BOUNDARY_CLASS,
                  frozenEdge(col.key),
                )}
              >
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={getRowId(row)} className={cn("break-inside-avoid", striped && "even:bg-muted/30")}>
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
          ))}
        </TableBody>
      </table>
    </div>,
    document.body,
  );
}
