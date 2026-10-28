import React, { useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
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
import { useIsMobile } from "../hooks/use-mobile";
import { cn } from "../lib/utils";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "../lib/format";

export type CellValue = string | number | boolean | null | undefined;
export type DataTableFormat = "currency" | "date" | "number" | "percent";

const NUMERIC_FORMATS: ReadonlySet<DataTableFormat | undefined> = new Set(["currency", "number", "percent"]);
const isNumericColumn = (col: { format?: DataTableFormat }) => NUMERIC_FORMATS.has(col.format);

export interface DataTableColumn<TRow> {
  key: string;
  label: string;
  /** Rótulo do campo no MobileCard; padrão: `label`. */
  mobileLabel?: string;
  /** Valor bruto da célula; usado para formato, busca, ordenação e título do MobileCard. */
  value?: (row: TRow) => CellValue;
  /** Conteúdo customizado (badges etc.); tem precedência sobre `value`/`format` na célula. */
  render?: (row: TRow) => React.ReactNode;
  format?: DataTableFormat;
  sortable?: boolean;
  /** Entra na busca local (requer `value`). */
  searchable?: boolean;
  /** Classes da célula no desktop (ex.: "font-mono text-xs text-muted-foreground"). */
  cellClassName?: string | ((row: TRow) => string | undefined);
  /** Classes do esqueleto de carregamento. Padrão: "h-4 w-full". */
  skeletonClassName?: string;
  /** Papel no MobileCard; colunas sem papel viram campos. */
  mobileRole?: "primary" | "secondary" | "hidden";
}

export type DataTablePagination =
  | { pageSize: number }
  | { page: number; totalPages: number; onPageChange: (page: number) => void };

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
  onSortChange?: (key: string, order: "asc" | "desc") => void;
  onSearchChange?: (value: string) => void;
  /** Envolve a tabela desktop em `border border-border` (visual do SDUITable). */
  bordered?: boolean;
  className?: string;
}

function formatValue(value: CellValue, format?: DataTableFormat): string {
  if (value === undefined || value === null) return "-";
  if (typeof value === "boolean") return String(value);
  if (format === "currency") return formatCurrency(value);
  if (format === "date") return formatDate(String(value));
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
}: DataTableProps<TRow>) {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | undefined>(undefined);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [clientPage, setClientPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

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
    const next = sortKey === key && order === "asc" ? "desc" : "asc";
    setSortKey(key);
    setOrder(next);
    onSortChange?.(key, next);
  };

  const hasActions = Boolean(rowActions);
  const primaryCol = columns.find((c) => c.mobileRole === "primary") ?? columns[0];
  const secondaryCol = columns.find((c) => c.mobileRole === "secondary");
  const fieldCols = columns.filter(
    (c) => c !== primaryCol && c !== secondaryCol && c.mobileRole !== "hidden",
  );
  const cellContent = (col: DataTableColumn<TRow>, row: TRow) =>
    col.render ? col.render(row) : text(col, row);

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

  return (
    <Card className={className}>
      {(heading || description || search) && (
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            {heading && <CardTitle className="text-base font-semibold">{heading}</CardTitle>}
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
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
                    label: c.mobileLabel ?? c.label,
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
                  fields={fieldCols.map((c) => ({ label: c.mobileLabel ?? c.label, value: cellContent(c, row) }))}
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
                  <TableRow className="bg-muted/40">
                    {renderExpanded && <TableHead className="w-12" />}
                    {columns.map((col) => (
                      <TableHead
                        key={col.key}
                        className={cn(col.sortable && "cursor-pointer select-none", isNumericColumn(col) && "text-right")}
                        onClick={() => col.sortable && handleSort(col.key)}
                      >
                        {col.sortable ? (
                          <div className={cn("flex items-center gap-1", isNumericColumn(col) && "justify-end")}>
                            <span>{col.label}</span>
                            <ArrowUpDown className="size-3 text-muted-foreground" />
                          </div>
                        ) : (
                          col.label
                        )}
                      </TableHead>
                    ))}
                    {hasActions && <TableHead className={actionsHeadClassName}>{actionsLabel}</TableHead>}
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
                          <TableRow className="hover:bg-muted/30">
                            {renderExpanded && <TableCell>{expandButton(row)}</TableCell>}
                            {columns.map((col) => (
                              <TableCell
                                key={col.key}
                                className={cn(
                                  isNumericColumn(col) && "text-right tabular-nums",
                                  typeof col.cellClassName === "function" ? col.cellClassName(row) : col.cellClassName,
                                )}
                              >
                                {cellContent(col, row)}
                              </TableCell>
                            ))}
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
            {footer}
          </>
        )}
      </CardContent>
    </Card>
  );
}
