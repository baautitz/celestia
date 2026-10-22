import React, { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ClosingPeriodRecord } from "@platform/shared";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { DatePicker } from "@platform/ui/components/date-picker";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@platform/ui/components/form";
import { useWindow, WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { Edit2, RefreshCw } from "lucide-react";
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

/** YYYY-MM-DD para Date local (sem deslocamento de fuso). */
const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Date local para YYYY-MM-DD (sem passar por UTC). */
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const rangeSchema = z
  .object({
    startDate: z.date({ message: "Informe a Data Inicial." }),
    endDate: z.date({ message: "Informe a Data Final." }),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "A Data Final não pode ser anterior à Data Inicial.",
    path: ["endDate"],
  });
type RangeFormValues = z.infer<typeof rangeSchema>;

const EditRangeSheet: React.FC<{ period: ClosingPeriodRecord }> = ({ period }) => {
  const { resolve } = useWindow<true>();
  const { feedback } = useUi();
  const [saving, setSaving] = useState(false);
  const form = useForm<RangeFormValues>({
    resolver: zodResolver(rangeSchema),
    defaultValues: { startDate: toDate(period.startDate), endDate: toDate(period.endDate) },
  });

  const onSubmit = async (v: RangeFormValues) => {
    try {
      setSaving(true);
      await api.closingPeriods.updateRange(period.id, {
        startDate: toIso(v.startDate),
        endDate: toIso(v.endDate),
        version: period.version,
      });
      feedback.notify({ title: "Faixa do período atualizada.", type: "success" });
      resolve(true);
    } catch (err: unknown) {
      feedback.notify({ title: err instanceof Error ? err.message : "Falha ao salvar a faixa", type: "error" });
      setSaving(false);
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="period-range-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem className="w-full">
                  <FormLabel className="w-full leading-snug">Data Inicial</FormLabel>
                  <FormControl>
                    <DatePicker value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="endDate"
              render={({ field }) => (
                <FormItem className="w-full">
                  <FormLabel className="w-full leading-snug">Data Final</FormLabel>
                  <FormControl>
                    <DatePicker value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FieldGroup>
        </form>
      </Form>
      <WindowActions>
        <WindowCancelButton />
        <Button type="submit" form="period-range-form" disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </WindowActions>
    </>
  );
};

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

  const openEditRange = async (period: ClosingPeriodRecord) => {
    const result = await ui.windows.open<true>({
      surface: "sheet",
      title: `Editar faixa: ${period.name}`,
      description: "Amplie ou reduza a faixa de datas. Os dias não podem pertencer a outro período.",
      content: () => <EditRangeSheet period={period} />,
    });
    if (result.status === "confirmed") fetchData();
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
        rowActions={(p) =>
          p.status === "open" && hasPermission("closing_period:period:update") ? (
            <Button variant="ghost" size="icon" aria-label="Editar faixa" title="Editar faixa" onClick={() => openEditRange(p)}>
              <Edit2 className="size-4" />
            </Button>
          ) : null
        }
      />
    </div>
  );
};
