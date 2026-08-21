import React, { useEffect, useState } from "react";
import type {
  DataTableProps,
  TableDataResponse,
  DataTableColumnDef,
  ActionDef,
  UIEffect,
} from "@platform/shared";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { MobileCard } from "@/components/ui/mobile-card";
import { api } from "@/lib/api-client";
import { useImperativeUI } from "@/context/ImperativeUIContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import {
  Search,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  PlusCircle,
  Eye,
  Settings,
} from "lucide-react";

interface SDUITableProps {
  id: string;
  props: DataTableProps;
  workspaceId: string;
  recipeId: string;
  startDate: string;
  endDate: string;
  availableActions?: Record<string, ActionDef>;
  isWorkspaceClosed?: boolean;
  readOnly?: boolean;
}

export const SDUITable: React.FC<SDUITableProps> = ({
  id,
  props,
  workspaceId,
  recipeId,
  startDate,
  endDate,
  availableActions = {},
  isWorkspaceClosed = false,
  readOnly = false,
}) => {
  const [data, setData] = useState<TableDataResponse<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState<number>(1);
  const pageSize = props.pagination?.pageSize || 10;
  const isMobile = useIsMobile();

  const { openDialog, showTableModal, updateTableData, confirm, triggerRefresh, refreshSignal } = useImperativeUI();

  const fetchData = () => {
    let isMounted = true;
    setLoading(true);

    api.workspaces
      .getData(workspaceId, id, {
        recipe_id: recipeId,
        start_date: startDate,
        end_date: endDate,
        page,
        page_size: pageSize,
        sort_by: sortBy,
        order,
        search: search || undefined,
      })
      .then((res) => {
        if (isMounted && res.type === "table") {
          setData(res as TableDataResponse<Record<string, unknown>>);
        }
      })
      .catch(() => {
        if (isMounted) setData(null);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  };

  useEffect(() => {
    fetchData();
  }, [id, workspaceId, recipeId, startDate, endDate, page, sortBy, order, refreshSignal]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setOrder("asc");
    }
  };

  const processEffects = async (effects: UIEffect[], row: Record<string, unknown>, actionId: string) => {
    for (const eff of effects) {
      if (eff.type === "toast") {
        if (eff.variant === "error") toast.error(eff.message);
        else if (eff.variant === "warning") toast.warning(eff.message);
        else if (eff.variant === "info") toast.info(eff.message);
        else toast.success(eff.message);
      } else if (eff.type === "refresh_data") {
        triggerRefresh();
      } else if (eff.type === "open_dialog") {
        const formValues = await openDialog(eff.options);
        if (!formValues) {
          toast.info("Ação cancelada.");
          return;
        }

        const res = await api.workspaces.execAction(workspaceId, {
          recipe_id: recipeId,
          action_id: actionId,
          row,
          form_data: formValues,
          workspace_version: 1,
        });

        if (res.effects) {
          await processEffects(res.effects, row, actionId);
        }
      } else if (eff.type === "show_table") {
        const fk = row.vendedor_id ?? row.id ?? Object.values(row)[0];
        const fetchCollection = async () => {
          return await api.workspaces.getCollection(
            workspaceId,
            eff.options.source,
            String(fk)
          );
        };
        const collectionData = await fetchCollection();
        await showTableModal({ ...eff.options, isWorkspaceClosed }, collectionData, async (subActionId, subItemRow) => {
          await executeActionEffect(subActionId, subItemRow);
          const updatedCollection = await fetchCollection();
          updateTableData(updatedCollection);
        });
      } else if (eff.type === "confirm") {
        const confirmed = await confirm({
          title: eff.title,
          message: eff.message,
        });
        if (!confirmed) return;

        const res = await api.workspaces.execAction(workspaceId, {
          recipe_id: recipeId,
          action_id: actionId,
          row,
          form_data: { confirmed: true, __confirmed: true },
          workspace_version: 1,
        });

        if (res.effects) {
          await processEffects(res.effects, row, actionId);
        }
      }
    }
  };

  const executeActionEffect = async (actionId: string, row: Record<string, unknown>) => {
    try {
      const result = await api.workspaces.execAction(workspaceId, {
        recipe_id: recipeId,
        action_id: actionId,
        row,
        workspace_version: 1,
      });

      if (result.effects) {
        await processEffects(result.effects, row, actionId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao executar ação";
      toast.error(msg);
    }
  };

  const getNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
    return path.split(".").reduce((acc: any, part) => (acc ? acc[part] : undefined), obj);
  };

  const formatCellValue = (col: DataTableColumnDef, row: Record<string, unknown>) => {
    let rawVal = getNestedValue(row, col.key);

    if (col.compute && typeof col.compute === "function") {
      rawVal = col.compute(row);
    }

    if (rawVal === undefined || rawVal === null) return "-";
    if (col.format === "currency") return formatCurrency(rawVal as number | string);
    if (col.format === "date") return formatDate(rawVal as string);
    return String(rawVal);
  };

  const getActionIcon = (iconName?: string) => {
    switch (iconName) {
      case "PlusCircle":
        return <PlusCircle className="size-4 mr-2" />;
      case "Eye":
        return <Eye className="size-4 mr-2" />;
      default:
        return <Settings className="size-4 mr-2" />;
    }
  };

  const totalRecords = data?.meta?.totalRecords ?? 0;
  const totalPages = data?.meta?.totalPages || 1;
  const rows = data?.data || [];

  // Quando a Área de Trabalho está concluída, exibe apenas ações de leitura
  const effectiveRowActions = isWorkspaceClosed
    ? (props.rowActions || []).filter((actId) => {
        const def = availableActions[actId];
        return def && (def as ActionDef & { nature?: string }).nature === "read";
      })
    : (props.rowActions || []).filter((actId) => Boolean(availableActions[actId]));

  const hasAuthorizedActions = !readOnly && effectiveRowActions.length > 0;

  return (
    <Card className="col-span-12">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-base font-semibold">{props.title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Total de {totalRecords} registro(s) apurado(s).
            </p>
          </div>

          {/* Barra de Busca */}
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 max-w-sm w-full">
            <InputGroup className="flex-1">
              <InputGroupInput
                type="search"
                placeholder="Buscar..."
                className="text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
            </InputGroup>
            <Button type="submit" variant="secondary" size="default">
              Buscar
            </Button>
          </form>
        </div>
      </CardHeader>

      <CardContent>
        {isMobile ? (
          <div className="flex flex-col gap-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, idx) => (
                <MobileCard
                  key={idx}
                  primary=""
                  secondary=""
                  fields={props.columns.map((c) => ({
                    label: c.label,
                    value: <Skeleton className="h-4 w-20" />,
                  }))}
                />
              ))
            ) : rows.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">
                Nenhum registro encontrado para o período selecionado.
              </p>
            ) : (
              rows.map((row, rowIdx) => (
                <MobileCard
                  key={rowIdx}
                  primary={formatCellValue(props.columns[0], row)}
                  secondary={props.columns.length > 1 ? String(row[props.columns[1].key] ?? "") : undefined}
                  fields={props.columns.slice(2).map((col) => ({
                    label: col.label,
                    value: formatCellValue(col, row),
                  }))}
                  actions={
                    hasAuthorizedActions ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          {effectiveRowActions.map((actionId) => {
                            const actionDef = availableActions[actionId];
                            return (
                              <DropdownMenuItem
                                key={actionId}
                                onClick={() => executeActionEffect(actionId, row)}
                                className="cursor-pointer"
                              >
                                {getActionIcon(actionDef?.icon)}
                                {actionDef?.label || actionId}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : undefined
                  }
                />
              ))
            )}

            {/* Rodapé de Paginação Mobile */}
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                Página {page} de {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="default"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-4 mr-1" />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                  <ChevronRight className="size-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    {props.columns.map((col) => (
                      <TableHead
                        key={col.key}
                        className={col.sortable ? "cursor-pointer select-none" : ""}
                        onClick={() => col.sortable && handleSort(col.key)}
                      >
                        <div className="flex items-center gap-1">
                          <span>{col.label}</span>
                          {col.sortable && <ArrowUpDown className="size-3 text-muted-foreground" />}
                        </div>
                      </TableHead>
                    ))}
                    {hasAuthorizedActions && (
                      <TableHead className="text-right w-24">Ações</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, idx) => (
                      <TableRow key={idx}>
                        {props.columns.map((c) => (
                          <TableCell key={c.key}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                        {hasAuthorizedActions && (
                          <TableCell>
                            <Skeleton className="h-8 w-8 ml-auto" />
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={props.columns.length + (hasAuthorizedActions ? 1 : 0)}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Nenhum registro encontrado para o período selecionado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row, rowIdx) => (
                      <TableRow key={rowIdx} className="hover:bg-muted/30">
                        {props.columns.map((col) => (
                          <TableCell key={col.key} className="font-mono text-xs">
                            {formatCellValue(col, row)}
                          </TableCell>
                        ))}

                        {hasAuthorizedActions && (
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button variant="ghost" size="icon">
                                    <MoreHorizontal className="size-4" />
                                  </Button>
                                }
                              />
                              <DropdownMenuContent align="end">
                                {effectiveRowActions.map((actionId) => {
                                    const actionDef = availableActions[actionId];
                                    return (
                                      <DropdownMenuItem
                                        key={actionId}
                                        onClick={() => executeActionEffect(actionId, row)}
                                        className="cursor-pointer"
                                      >
                                        {getActionIcon(actionDef?.icon)}
                                        {actionDef?.label || actionId}
                                      </DropdownMenuItem>
                                    );
                                  })}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Rodapé de Paginação */}
            <div className="flex items-center justify-between py-4 border-t border-border">
              <span className="text-xs text-muted-foreground">
                Página {page} de {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="default"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-4 mr-1" />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                  <ChevronRight className="size-4 ml-1" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
