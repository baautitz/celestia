import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Erp, ErpDriverMeta, FormFieldDef } from "@platform/shared";
import { Button } from "@platform/ui/components/button";
import { PageHeader, Show, Spin, Stack } from "@platform/ui/components/layout";
import { Input } from "@platform/ui/components/input";
import { Badge } from "@platform/ui/components/badge";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@platform/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@platform/ui/components/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@platform/ui/components/dropdown-menu";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { PlusCircle, RefreshCw, MoreHorizontal, Edit2, PlugZap, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";

import { HeaderActions } from "@/context/HeaderActionsContext";
import { DynamicFormFields } from "@platform/ui/forms/DynamicFormFields";
import {
  buildDynamicDefaultValues,
  buildDynamicSchema,
  normalizeDynamicFormValues,
  type DynamicFormValues,
} from "@platform/ui/forms/dynamic-form";

const baseSchema = z.object({
  name: z.string().min(1, "Informe o nome do ERP."),
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "Use letras minúsculas, números e _ (ex.: inovafarma)."),
  driver: z.string().min(1, "Selecione o ERP Driver."),
});

const formatDate = (iso: string) => new Date(iso).toLocaleString("pt-BR");

interface ErpFormProps {
  editing: Erp | null;
  drivers: ErpDriverMeta[];
}

const ErpFormContent: React.FC<ErpFormProps> = ({ editing, drivers }) => {
  const ui = useUi();
  const { resolve } = useWindow<true>();
  const [saving, setSaving] = useState(false);
  const isEditMode = editing !== null;

  // O schema depende do tipo escolhido (lido do próprio form), então o resolver o consulta na hora da validação.
  const form = useForm<DynamicFormValues>({
    defaultValues: editing
      ? {
          ...buildDynamicDefaultValues(drivers.find((d) => d.id === editing.driver)?.fields ?? []),
          ...editing.config,
          name: editing.name,
          id: editing.id,
          driver: editing.driver,
        }
      : {
          name: "",
          id: "",
          driver: drivers[0]?.id ?? "",
          ...buildDynamicDefaultValues(drivers[0]?.fields ?? []),
        },
    resolver: (values, context, options) => zodResolver(schema)(values, context, options),
  });
  const driverId = form.watch("driver") as string;

  // Numa edição, a senha em branco mantém a atual: os campos "password" deixam de ser obrigatórios.
  const driverFields: FormFieldDef[] = useMemo(() => {
    const fields = drivers.find((d) => d.id === driverId)?.fields ?? [];
    return fields.map((f) => (f.type === "password" && isEditMode ? { ...f, required: false } : f));
  }, [drivers, driverId, isEditMode]);

  const schema = useMemo(() => baseSchema.extend(buildDynamicSchema(driverFields).shape), [driverFields]);

  const handleDriverChange = (nextDriverId: string) => {
    const fields = drivers.find((d) => d.id === nextDriverId)?.fields ?? [];
    form.reset({
      name: form.getValues("name"),
      id: form.getValues("id"),
      driver: nextDriverId,
      ...buildDynamicDefaultValues(fields),
    });
  };

  const handleSave = async (raw: DynamicFormValues) => {
    try {
      setSaving(true);
      await api.erps.save(String(raw.id), {
        name: String(raw.name).trim(),
        driver: String(raw.driver),
        values: normalizeDynamicFormValues(driverFields, raw),
      });
      ui.feedback.notify({
        type: "success",
        title: isEditMode ? "ERP atualizado com sucesso!" : "ERP cadastrado com sucesso!",
      });
      resolve(true);
    } catch (err: unknown) {
      ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : "Falha ao salvar ERP" });
      setSaving(false);
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="erp-form" onSubmit={form.handleSubmit(handleSave)} noValidate>
<Stack gap="section">
                <FormField
              control={form.control}
              name="driver"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ERP Driver</FormLabel>
                    <Select
                      value={String(field.value ?? "")}
                      disabled={isEditMode}
                      onValueChange={(val: string | null) => handleDriverChange(val ?? "")}
                    >
                      <FormControl>
                        <SelectTrigger fullWidth>
                          <SelectValue placeholder="Selecione o ERP Driver">
                            {drivers.find((d) => d.id === field.value)?.label}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {drivers.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex: InovaFarma"
                      value={String(field.value ?? "")}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Identificador (usado nos módulos)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="inovafarma"
                      value={String(field.value ?? "")}
                      disabled={isEditMode}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />


          <DynamicFormFields fields={driverFields} form={form} />
</Stack>
        </form>
      </Form>
      <WindowActions>
        <WindowCancelButton />
        <Button form="erp-form" type="submit" disabled={saving}>
          {saving ? "Salvando..." : isEditMode ? "Salvar Alterações" : "Cadastrar ERP"}
        </Button>
      </WindowActions>
    </>
  );
};

export const ERPsPage: React.FC = () => {
  const ui = useUi();
  const [erps, setErps] = useState<Erp[]>([]);
  const [drivers, setDrivers] = useState<ErpDriverMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [erpsRes, driversRes] = await Promise.all([api.erps.list(), api.erps.listDrivers()]);
      setErps(erpsRes);
      setDrivers(driversRes);
    } catch (err: unknown) {
      ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : "Erro ao carregar ERPs" });
    } finally {
      setLoading(false);
    }
  }, [ui]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const driverLabel = (id: string) => drivers.find((t) => t.id === id)?.label ?? id;

  const openSheet = async (erp: Erp | null) => {
    const result = await ui.windows.open<true>({
      surface: "sheet",
      title: erp ? `Editar ERP: ${erp.name}` : "Novo ERP",
      description: erp
        ? "Atualize os dados de acesso. Deixe a senha em branco para manter a atual."
        : "Escolha o ERP Driver e informe os dados de acesso.",
      content: () => <ErpFormContent editing={erp} drivers={drivers} />,
    });
    if (result.status === "confirmed") fetchData();
  };

  const handleTest = async (erp: Erp) => {
    const ok = await api.erps.test(erp.id);
    if (ok) ui.feedback.notify({ type: "success", title: `ERP '${erp.name}' respondeu ao teste.` });
    else ui.feedback.notify({ type: "error", title: `O ERP '${erp.name}' não respondeu ao teste.` });
  };

  const handleDelete = async (erp: Erp) => {
    const confirmed = await ui.windows.confirm({
      title: "Excluir ERP",
      description: `Excluir "${erp.name}" (${erp.id}) remove o ERP. Os módulos que o usam deixarão de carregar dados.`,
      confirmLabel: "Excluir",
    });
    if (!confirmed) return;
    try {
      await api.erps.remove(erp.id);
      ui.feedback.notify({ type: "success", title: "ERP excluído." });
      fetchData();
    } catch (err: unknown) {
      ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : "Falha ao excluir ERP" });
    }
  };

  const columns: DataTableColumn<Erp>[] = [
    {
      key: "id",
      label: "Identificador",
      value: (e) => e.id,
      mobileRole: "secondary",
      cellClassName: "font-mono text-xs font-semibold",
      skeletonClassName: "h-4 w-24",
    },
    {
      key: "name",
      label: "Nome",
      value: (e) => e.name,
      mobileRole: "primary",
      cellClassName: "font-medium",
      skeletonClassName: "h-4 w-32",
    },
    {
      key: "driver",
      label: "ERP Driver",
      value: (e) => driverLabel(e.driver),
      render: (e) => <Badge variant="secondary">{driverLabel(e.driver)}</Badge>,
      skeletonClassName: "h-5 w-20",
    },
    {
      key: "updatedAt",
      label: "Atualizado em",
      value: (e) => formatDate(e.updatedAt),
      cellClassName: "text-xs text-muted-foreground",
      skeletonClassName: "h-4 w-32",
    },
  ];

  const rowMenu = (erp: Erp) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleTest(erp)}>
          <PlugZap />
          Testar ERP
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openSheet(erp)}>
          <Edit2 />
          Editar ERP
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleDelete(erp)} variant="destructive">
          <Trash2 />
          Excluir ERP
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <Stack gap="section">
      <HeaderActions>
        <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
          <Spin active={loading}><RefreshCw /></Spin>
        </Button>

        <Show on="desktop">
          <Button onClick={() => openSheet(null)} disabled={drivers.length === 0}>
            <PlusCircle />
            Novo ERP
          </Button>
        </Show>

        <Show on="mobile">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openSheet(null)}>
                <PlusCircle />
                Novo ERP
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      </HeaderActions>

      <PageHeader title="ERPs" description="Cadastre os ERPs de onde os módulos leem dados. As consultas aos ERPs são somente leitura." />

      <DataTable
        columns={columns}
        rows={erps}
        getRowId={(e) => e.id}
        loading={loading}
        skeletonRows={3}
        title={`ERPs Cadastrados (${erps.length})`}
        emptyMessage="Nenhum ERP cadastrado."
        rowActions={rowMenu}
      />
    </Stack>
  );
};
