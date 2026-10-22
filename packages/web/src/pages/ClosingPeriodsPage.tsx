import React, { useCallback, useEffect, useState } from "react";
import type { ClosingPeriodRecord } from "@platform/shared";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@platform/ui/components/dropdown-menu";
import { Lock, LockOpen, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";

/** YYYY-MM-DD para DD/MM/AAAA, sem passar por Date (evita deslocamento de fuso). */
const formatDay = (iso: string) => iso.split("-").reverse().join("/");

const columns: DataTableColumn<ClosingPeriodRecord>[] = [
  {
    key: "name",
    label: "Nome",
    value: (p) => p.name,
    mobileRole: "primary",
    cellClassName: "font-medium",
    skeletonClassName: "h-4 w-32",
  },
  {
    key: "startDate",
    label: "Data Inicial",
    value: (p) => formatDay(p.startDate),
    mobileRole: "secondary",
    skeletonClassName: "h-4 w-24",
  },
  {
    key: "endDate",
    label: "Data Final",
    value: (p) => formatDay(p.endDate),
    skeletonClassName: "h-4 w-24",
  },
  {
    key: "status",
    label: "Situação",
    value: (p) => (p.status === "open" ? "Aberto" : "Fechado"),
    render: (p) => (
      <Badge variant={p.status === "open" ? "secondary" : "outline"}>{p.status === "open" ? "Aberto" : "Fechado"}</Badge>
    ),
    skeletonClassName: "h-5 w-16",
  },
];

export const ClosingPeriodsPage: React.FC = () => {
  const ui = useUi();
  const { hasPermission } = useAuth();
  const [periods, setPeriods] = useState<ClosingPeriodRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setPeriods(await api.closingPeriods.list());
    } catch (err: unknown) {
      ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : "Erro ao carregar Períodos de Fechamento" });
    } finally {
      setLoading(false);
    }
  }, [ui]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    try {
      await action();
      ui.feedback.notify({ type: "success", title: success });
      fetchData();
    } catch (err: unknown) {
      ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : failure });
    }
  };

  const handleClose = async (p: ClosingPeriodRecord) => {
    const confirmed = await ui.windows.confirm({
      title: "Fechar período",
      description: `Fechar "${p.name}" (${formatDay(p.startDate)} a ${formatDay(p.endDate)})?`,
      confirmLabel: "Fechar",
    });
    if (confirmed) await run(() => api.closingPeriods.close(p.id), "Período fechado.", "Falha ao fechar período");
  };

  const handleReopen = async (p: ClosingPeriodRecord) => {
    const confirmed = await ui.windows.confirm({
      title: "Reabrir período",
      description: `Reabrir "${p.name}"?`,
      confirmLabel: "Reabrir",
    });
    if (confirmed) await run(() => api.closingPeriods.reopen(p.id), "Período reaberto.", "Falha ao reabrir período");
  };

  const handleCancel = async (p: ClosingPeriodRecord) => {
    const confirmed = await ui.windows.confirm({
      title: "Cancelar período",
      description: `Cancelar "${p.name}" remove o período e libera suas datas.`,
      confirmLabel: "Cancelar período",
    });
    if (confirmed) await run(() => api.closingPeriods.cancel(p.id), "Período cancelado.", "Falha ao cancelar período");
  };

  const rowMenu = (p: ClosingPeriodRecord) => {
    const canClose = p.status === "open" && hasPermission("closing_period:period:close");
    const canReopen = p.status === "closed" && hasPermission("closing_period:period:reopen");
    const canCancel = p.status === "open" && hasPermission("closing_period:period:cancel");
    if (!canClose && !canReopen && !canCancel) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canClose && (
            <DropdownMenuItem onClick={() => handleClose(p)} className="cursor-pointer">
              <Lock className="size-4 mr-2" />
              Fechar período
            </DropdownMenuItem>
          )}
          {canReopen && (
            <DropdownMenuItem onClick={() => handleReopen(p)} className="cursor-pointer">
              <LockOpen className="size-4 mr-2" />
              Reabrir período
            </DropdownMenuItem>
          )}
          {canCancel && (
            <DropdownMenuItem onClick={() => handleCancel(p)} className="cursor-pointer text-destructive">
              <Trash2 className="size-4 mr-2" />
              Cancelar período
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <HeaderActions>
        <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </HeaderActions>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Períodos de Fechamento</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cada período é uma faixa contínua de datas; uma data pertence a no máximo um período.
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={periods}
        getRowId={(p) => p.id}
        loading={loading}
        skeletonRows={3}
        title={`Períodos (${periods.length})`}
        emptyMessage="Nenhum Período de Fechamento criado."
        rowActions={rowMenu}
      />
    </div>
  );
};
