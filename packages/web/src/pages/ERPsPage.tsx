import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ErpConnection, ErpTypeMeta, FormFieldDef } from "@platform/shared";
import { Button } from "@platform/ui/components/button";
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

const fetchErpLookupOptions = (field: { name: string }) => api.lookups.fetch("", field.name);
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
  type: z.string().min(1, "Selecione o tipo de ERP."),
});

const formatDate = (iso: string) => new Date(iso).toLocaleString("pt-BR");

interface ErpFormProps {
  editing: ErpConnection | null;
  types: ErpTypeMeta[];
}

const ErpFormContent: React.FC<ErpFormProps> = ({ editing, types }) => {
  const ui = useUi();
  const { resolve } = useWindow<true>();
  const [saving, setSaving] = useState(false);
  const isEditMode = editing !== null;

  // O schema depende do tipo escolhido (lido do próprio form), então o resolver o consulta na hora da validação.
  const form = useForm<DynamicFormValues>({
    defaultValues: editing
      ? {
          ...buildDynamicDefaultValues(types.find((t) => t.id === editing.type)?.fields ?? []),
          ...editing.config,
          name: editing.name,
          id: editing.id,
          type: editing.type,
        }
      : {
          name: "",
          id: "",
          type: types[0]?.id ?? "",
          ...buildDynamicDefaultValues(types[0]?.fields ?? []),
        },
    resolver: (values, context, options) => zodResolver(schema)(values, context, options),
  });
  const typeId = form.watch("type") as string;

  // Numa edição, a senha em branco mantém a atual: os campos "password" deixam de ser obrigatórios.
  const typeFields: FormFieldDef[] = useMemo(() => {
    const fields = types.find((t) => t.id === typeId)?.fields ?? [];
    return fields.map((f) => (f.type === "password" && isEditMode ? { ...f, required: false } : f));
  }, [types, typeId, isEditMode]);

  const schema = useMemo(() => baseSchema.extend(buildDynamicSchema(typeFields).shape), [typeFields]);

  const handleTypeChange = (nextTypeId: string) => {
    const fields = types.find((t) => t.id === nextTypeId)?.fields ?? [];
    form.reset({
      name: form.getValues("name"),
      id: form.getValues("id"),
      type: nextTypeId,
      ...buildDynamicDefaultValues(fields),
    });
  };

  const handleSave = async (raw: DynamicFormValues) => {
    try {
      setSaving(true);
      await api.erps.save(String(raw.id), {
        name: String(raw.name).trim(),
        type: String(raw.type),
        values: normalizeDynamicFormValues(typeFields, raw),
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
        <form id="erp-form" onSubmit={form.handleSubmit(handleSave)} className="flex flex-col gap-6" noValidate>
                <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de ERP</FormLabel>
                    <Select
                      value={String(field.value ?? "")}
                      disabled={isEditMode}
                      onValueChange={(val: string | null) => handleTypeChange(val ?? "")}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {types.map((t) => (
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
                  <FormLabel>Identificador (usado nos Dashboards)</FormLabel>
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


          <DynamicFormFields fields={typeFields} form={form} fetchLookupOptions={fetchErpLookupOptions} />
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
  const [erps, setErps] = useState<ErpConnection[]>([]);
  const [types, setTypes] = useState<ErpTypeMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [erpsRes, typesRes] = await Promise.all([api.erps.list(), api.erps.listTypes()]);
      setErps(erpsRes);
      setTypes(typesRes);
    } catch (err: unknown) {
      ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : "Erro ao carregar ERPs" });
    } finally {
      setLoading(false);
    }
  }, [ui]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const typeLabel = (id: string) => types.find((t) => t.id === id)?.label ?? id;

  const openSheet = async (erp: ErpConnection | null) => {
    const result = await ui.windows.open<true>({
      surface: "sheet",
      title: erp ? `Editar ERP: ${erp.name}` : "Novo ERP",
      description: erp
        ? "Atualize os dados de conexão. Deixe a senha em branco para manter a atual."
        : "Escolha o tipo de ERP e informe os dados de conexão.",
      content: () => <ErpFormContent editing={erp} types={types} />,
    });
    if (result.status === "confirmed") fetchData();
  };

  const handleTest = async (erp: ErpConnection) => {
    const ok = await api.erps.test(erp.id);
    if (ok) ui.feedback.notify({ type: "success", title: `Conexão com '${erp.name}' estabelecida.` });
    else ui.feedback.notify({ type: "error", title: `Não foi possível conectar em '${erp.name}'.` });
  };

  const handleDelete = async (erp: ErpConnection) => {
    const confirmed = await ui.windows.confirm({
      title: "Excluir ERP",
      description: `Excluir "${erp.name}" (${erp.id}) remove a conexão. Os Dashboards que usam essa fonte deixarão de carregar dados.`,
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

  const columns: DataTableColumn<ErpConnection>[] = [
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
      key: "type",
      label: "Tipo",
      value: (e) => typeLabel(e.type),
      render: (e) => <Badge variant="secondary">{typeLabel(e.type)}</Badge>,
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

  const rowMenu = (erp: ErpConnection) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleTest(erp)} className="cursor-pointer">
          <PlugZap className="size-4 mr-2" />
          Testar conexão
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openSheet(erp)} className="cursor-pointer">
          <Edit2 className="size-4 mr-2" />
          Editar ERP
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleDelete(erp)} className="cursor-pointer text-destructive">
          <Trash2 className="size-4 mr-2" />
          Excluir ERP
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex flex-col gap-6">
      <HeaderActions>
        <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>

        <Button onClick={() => openSheet(null)} className="hidden lg:inline-flex shrink-0" disabled={types.length === 0}>
          <PlusCircle className="size-3.5 mr-1.5" />
          Novo ERP
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon" className="size-8 shrink-0 lg:hidden" />}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openSheet(null)} className="cursor-pointer">
              <PlusCircle className="size-4 mr-2" />
              Novo ERP
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </HeaderActions>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">ERPs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cadastre os ERPs de onde os Dashboards leem dados. As conexões são somente leitura.
        </p>
      </div>

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
    </div>
  );
};
