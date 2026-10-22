import React, { useCallback, useEffect, useState } from "react";
import type { ClosingPeriodRecord } from "@platform/shared";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { RefreshCw } from "lucide-react";
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
      />
    </div>
  );
};
