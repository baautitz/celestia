import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { FormFieldDef, OpenDialogOptions, ShowTableOptions } from "@platform/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { MobileCard } from "@/components/ui/mobile-card";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Trash2 } from "lucide-react";

interface ConfirmOptions {
  title: string;
  message: string;
}

interface ImperativeUIContextType {
  openDialog: (options: OpenDialogOptions) => Promise<Record<string, unknown> | null>;
  showTableModal: (
    options: ShowTableOptions,
    data: Record<string, unknown>[],
    onAction?: (actionId: string, row: Record<string, unknown>) => Promise<void>
  ) => Promise<void>;
  updateTableData: (data: Record<string, unknown>[]) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  triggerRefresh: () => void;
  refreshSignal: number;
}

const ImperativeUIContext = createContext<ImperativeUIContextType | undefined>(undefined);

export const ImperativeUIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [refreshSignal, setRefreshSignal] = useState(0);
  const isMobile = useIsMobile();

  // Estado do Diálogo Imperativo (ui.dialog.open)
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    options: OpenDialogOptions | null;
    values: Record<string, unknown>;
    resolve: ((values: Record<string, unknown> | null) => void) | null;
  }>({
    isOpen: false,
    options: null,
    values: {},
    resolve: null,
  });

  // Estado da Tabela Modal (ui.showTable)
  const [tableState, setTableState] = useState<{
    isOpen: boolean;
    options: ShowTableOptions | null;
    data: Record<string, unknown>[];
    onAction?: (actionId: string, row: Record<string, unknown>) => Promise<void>;
    resolve: (() => void) | null;
  }>({
    isOpen: false,
    options: null,
    data: [],
    resolve: null,
  });

  // Estado do Confirm Dialog (ui.confirm)
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions | null;
    resolve: ((result: boolean) => void) | null;
  }>({
    isOpen: false,
    options: null,
    resolve: null,
  });

  const triggerRefresh = useCallback(() => {
    setRefreshSignal((prev) => prev + 1);
  }, []);

  const openDialog = useCallback((options: OpenDialogOptions): Promise<Record<string, unknown> | null> => {
    return new Promise((resolve) => {
      const initialValues: Record<string, unknown> = {};
      options.fields.forEach((field) => {
        initialValues[field.name] = field.defaultValue !== undefined ? field.defaultValue : "";
      });

      setDialogState({
        isOpen: true,
        options,
        values: initialValues,
        resolve,
      });
    });
  }, []);

  const handleDialogSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setDialogState((prev) => {
      if (prev.resolve) {
        prev.resolve(prev.values);
      }
      return { isOpen: false, options: null, values: {}, resolve: null };
    });
  }, []);

  const handleDialogCancel = () => {
    if (dialogState.resolve) {
      dialogState.resolve(null);
    }
    setDialogState({ isOpen: false, options: null, values: {}, resolve: null });
  };

  const showTableModal = useCallback((
    options: ShowTableOptions,
    data: Record<string, unknown>[],
    onAction?: (actionId: string, row: Record<string, unknown>) => Promise<void>
  ): Promise<void> => {
    return new Promise((resolve) => {
      setTableState({
        isOpen: true,
        options,
        data,
        onAction,
        resolve,
      });
    });
  }, []);

  const handleTableClose = useCallback(() => {
    if (tableState.resolve) {
      tableState.resolve();
    }
    setTableState({ isOpen: false, options: null, data: [], resolve: null });
  }, []);

  const updateTableData = useCallback((data: Record<string, unknown>[]) => {
    setTableState((prev) => ({
      ...prev,
      data,
    }));
  }, []);

  const handleRowAction = async (actionId: string, row: Record<string, unknown>) => {
    if (tableState.onAction) {
      await tableState.onAction(actionId, row);
    }
  };

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        options,
        resolve,
      });
    });
  }, []);

  const handleConfirmResult = (result: boolean) => {
    if (confirmState.resolve) {
      confirmState.resolve(result);
    }
    setConfirmState({ isOpen: false, options: null, resolve: null });
  };

  const renderField = (field: FormFieldDef) => {
    const value = dialogState.values[field.name];

    switch (field.type) {
      case "textarea":
        return (
          <Field key={field.name}>
            <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
            <Textarea
              id={field.name}
              value={String(value ?? "")}
              disabled={field.readOnly}
              required={field.required}
              onChange={(e) =>
                setDialogState((prev) => ({
                  ...prev,
                  values: { ...prev.values, [field.name]: e.target.value },
                }))
              }
            />
          </Field>
        );

      case "switch":
        return (
          <Field key={field.name} orientation="horizontal" className="justify-between items-center py-2">
            <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
            <Switch
              id={field.name}
              checked={Boolean(value)}
              disabled={field.readOnly}
              onCheckedChange={(checked) =>
                setDialogState((prev) => ({
                  ...prev,
                  values: { ...prev.values, [field.name]: checked },
                }))
              }
            />
          </Field>
        );

      case "select": {
        const rawOptions = field.options || [];
        const normalizedOptions = rawOptions.map((opt) =>
          typeof opt === "string" ? { value: opt, label: opt } : { value: String(opt.value), label: opt.label }
        );

        return (
          <Field key={field.name}>
            <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
            <Select
              value={String(value ?? "")}
              disabled={field.readOnly}
              onValueChange={(val: string | null) =>
                val &&
                setDialogState((prev) => ({
                  ...prev,
                  values: { ...prev.values, [field.name]: val },
                }))
              }
            >
              <SelectTrigger id={field.name}>
                <SelectValue placeholder="Selecione uma opção" />
              </SelectTrigger>
              <SelectContent>
                {normalizedOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        );
      }

      case "money":
      case "number":
        return (
          <Field key={field.name}>
            <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
            <Input
              id={field.name}
              type="number"
              step={field.type === "money" ? "0.01" : "1"}
              value={value !== undefined ? String(value) : ""}
              disabled={field.readOnly}
              required={field.required}
              onChange={(e) =>
                setDialogState((prev) => ({
                  ...prev,
                  values: {
                    ...prev.values,
                    [field.name]: e.target.value === "" ? "" : Number(e.target.value),
                  },
                }))
              }
            />
          </Field>
        );

      default:
        return (
          <Field key={field.name}>
            <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
            <Input
              id={field.name}
              type={field.type === "date" ? "date" : "text"}
              value={String(value ?? "")}
              disabled={field.readOnly}
              required={field.required}
              onChange={(e) =>
                setDialogState((prev) => ({
                  ...prev,
                  values: { ...prev.values, [field.name]: e.target.value },
                }))
              }
            />
          </Field>
        );
    }
  };

  const formatTableCell = (format: string | undefined, val: unknown) => {
    if (val === undefined || val === null) return "-";
    if (format === "currency") return formatCurrency(val as number | string);
    if (format === "date" || format === "datetime") return formatDate(val as string);
    return String(val);
  };

  const contextValue = useMemo(() => ({
    openDialog,
    showTableModal,
    updateTableData,
    confirm,
    triggerRefresh,
    refreshSignal,
  }), [openDialog, showTableModal, confirm, triggerRefresh, refreshSignal]);

  return (
    <ImperativeUIContext.Provider value={contextValue}>
      {children}

      {/* Modal Dinâmico de Diálogo (ui.dialog.open) */}
      <Dialog open={dialogState.isOpen} onOpenChange={(open) => !open && handleDialogCancel()}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleDialogSubmit}>
            <DialogHeader>
              <DialogTitle>{dialogState.options?.title}</DialogTitle>
              {dialogState.options?.description && (
                <DialogDescription>{dialogState.options.description}</DialogDescription>
              )}
            </DialogHeader>

            <FieldGroup className="py-4">
              {dialogState.options?.fields.map((field) => renderField(field))}
            </FieldGroup>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={handleDialogCancel}>
                {dialogState.options?.cancelLabel || "Cancelar"}
              </Button>
              <Button type="submit" variant="default">
                {dialogState.options?.confirmLabel || "Confirmar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Tabela de Auditoria / Sub-itens (ui.showTable) */}
      <Dialog open={tableState.isOpen} onOpenChange={(open) => !open && handleTableClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{tableState.options?.title}</DialogTitle>
            <DialogDescription>
              Registros persistidos vinculados a este fechamento ({tableState.data.length} registro(s)).
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto border border-border mt-2">
            {isMobile ? (
              <div className="flex flex-col gap-3 p-2">
                {tableState.data.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground text-sm">
                    Nenhum registro encontrado.
                  </p>
                ) : (
                  tableState.data.map((row, idx) => (
                    <MobileCard
                      key={idx}
                      primary={tableState.options?.columns[0] ? formatTableCell(tableState.options.columns[0].format, row[tableState.options.columns[0].key]) : ""}
                      secondary={tableState.options?.columns[1] ? formatTableCell(tableState.options.columns[1].format, row[tableState.options.columns[1].key]) : undefined}
                      fields={(tableState.options?.columns || []).slice(2).map((col) => ({
                        label: col.label,
                        value: formatTableCell(col.format, row[col.key]),
                      }))}
                      actions={
                        tableState.options?.rowActions && !tableState.options.isWorkspaceClosed ? (
                          <div className="flex items-center gap-1">
                            {tableState.options.rowActions.map((actionId) => (
                              <Button
                                key={actionId}
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive/80"
                                onClick={() => handleRowAction(actionId, row)}
                                title="Remover Registro"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            ))}
                          </div>
                        ) : undefined
                      }
                    />
                  ))
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    {tableState.options?.columns.map((col) => (
                      <TableHead key={col.key}>{col.label}</TableHead>
                    ))}
                    {tableState.options?.rowActions && tableState.options.rowActions.length > 0 && !tableState.options.isWorkspaceClosed && (
                      <TableHead className="text-right w-16">Ação</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableState.data.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={(tableState.options?.columns.length || 1) + (tableState.options?.rowActions && !tableState.options.isWorkspaceClosed ? 1 : 0)}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Nenhum registro encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    tableState.data.map((row, idx) => (
                      <TableRow key={idx}>
                        {tableState.options?.columns.map((col) => (
                          <TableCell key={col.key} className="font-mono text-xs">
                            {formatTableCell(col.format, row[col.key])}
                          </TableCell>
                        ))}
                        {tableState.options?.rowActions && !tableState.options.isWorkspaceClosed && (
                          <TableCell className="text-right">
                            {tableState.options.rowActions.map((actionId) => (
                              <Button
                                key={actionId}
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive/80"
                                onClick={() => handleRowAction(actionId, row)}
                                title="Remover Registro"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            ))}
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button type="button" variant="secondary" onClick={handleTableClose}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação (ui.confirm) */}
      <AlertDialog open={confirmState.isOpen} onOpenChange={(open) => !open && handleConfirmResult(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState.options?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmState.options?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleConfirmResult(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleConfirmResult(true)}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ImperativeUIContext.Provider>
  );
};

export const useImperativeUI = (): ImperativeUIContextType => {
  const context = useContext(ImperativeUIContext);
  if (!context) {
    throw new Error("useImperativeUI deve ser usado dentro de um ImperativeUIProvider");
  }
  return context;
};
