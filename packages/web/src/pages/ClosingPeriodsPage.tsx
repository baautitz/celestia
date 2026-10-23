import React, { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Edit2, Lock, LockOpen, MoreHorizontal, Plus, RefreshCw, Trash2 } from "lucide-react";
import { DatePicker } from "@platform/ui/components/date-picker";
import { Input } from "@platform/ui/components/input";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@platform/ui/components/form";
import { useWindow, WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
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

const createSchema = z
  .object({
    name: z.string().min(1, "Informe o nome do período."),
    startDate: z.date({ message: "Informe a Data Inicial." }),
    endDate: z.date({ message: "Informe a Data Final." }),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "A Data Final não pode ser anterior à Data Inicial.",
    path: ["endDate"],
  });
type CreateFormValues = z.infer<typeof createSchema>;

const CreatePeriodSheet: React.FC = () => {
  const { resolve } = useWindow<true>();
  const { feedback } = useUi();
  const [saving, setSaving] = useState(false);
  const form = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "" },
  });

  const onSubmit = async (v: CreateFormValues) => {
    try {
      setSaving(true);
      await api.closingPeriods.create({
        name: v.name.trim(),
        startDate: toIso(v.startDate),
        endDate: toIso(v.endDate),
      });
      feedback.notify({ title: "Período de Fechamento criado.", type: "success" });
      resolve(true);
    } catch (err: unknown) {
      feedback.notify({ title: err instanceof Error ? err.message : "Falha ao criar período", type: "error" });
      setSaving(false);
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="create-period-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="w-full">
                  <FormLabel className="w-full leading-snug">Nome do Período</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex.: Outubro/2026" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
        <Button type="submit" form="create-period-form" disabled={saving}>
          {saving ? "Criando..." : "Criar Período"}
        </Button>
      </WindowActions>
    </>
  );
};

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
    const canEdit = p.status === "open" && hasPermission("closing_period:period:update");
    if (!canEdit && !canClose && !canReopen && !canCancel) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && (
            <DropdownMenuItem onClick={() => openEditRange(p)} className="cursor-pointer">
              <Edit2 className="size-4 mr-2" />
              Editar faixa
            </DropdownMenuItem>
          )}
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

  const openCreatePeriod = async () => {
    const result = await ui.windows.open<true>({
      surface: "sheet",
      title: "Novo Período de Fechamento",
      description: "Defina o nome e a faixa contínua de datas para o período.",
      content: () => <CreatePeriodSheet />,
    });
    if (result.status === "confirmed") fetchData();
  };

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
    <>
      <HeaderActions>
        {hasPermission("closing_period:period:create") && (
          <Button onClick={openCreatePeriod} className="gap-2">
            <Plus className="size-4" />
            Novo Período
          </Button>
        )}
        <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
      </HeaderActions>

      <DataTable
        columns={columns}
        rows={periods}
        getRowId={(p) => p.id}
        loading={loading}
        skeletonRows={3}
        title={(count) => `Períodos de Fechamento (${count})`}
        description="Cada período é uma faixa contínua de datas; uma data pertence a no máximo um período."
        emptyMessage="Nenhum Período de Fechamento criado."
        rowActions={rowMenu}
      />
    </>
  );
};
