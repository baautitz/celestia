import React, { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ErpConnection, ErpTypeMeta, FormFieldDef } from "@platform/shared";
import { Card, CardHeader, CardTitle, CardContent } from "@platform/ui/components/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@platform/ui/components/table";
import { Button } from "@platform/ui/components/button";
import { Input } from "@platform/ui/components/input";
import { Badge } from "@platform/ui/components/badge";
import { Skeleton } from "@platform/ui/components/skeleton";
import { MobileCard } from "@platform/ui/components/mobile-card";
import { useIsMobile } from "@platform/ui/hooks/use-mobile";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@platform/ui/components/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@platform/ui/components/alert-dialog";
import { ScrollArea } from "@platform/ui/components/scroll-area";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@platform/ui/components/dropdown-menu";
import { toast } from "@platform/ui/components/toast";
import { PlusCircle, RefreshCw, MoreHorizontal, Edit2, PlugZap, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";
import { DynamicFormFields } from "@/components/forms/DynamicFormFields";
import {
  buildDynamicDefaultValues,
  buildDynamicSchema,
  normalizeDynamicFormValues,
  type DynamicFormValues,
} from "@/lib/dynamic-form";

const baseSchema = z.object({
  name: z.string().min(1, "Informe o nome do ERP."),
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "Use letras minúsculas, números e _ (ex.: inovafarma)."),
  type: z.string().min(1, "Selecione o tipo de ERP."),
});

const formatDate = (iso: string) => new Date(iso).toLocaleString("pt-BR");

export const ERPsPage: React.FC = () => {
  const [erps, setErps] = useState<ErpConnection[]>([]);
  const [types, setTypes] = useState<ErpTypeMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ErpConnection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ErpConnection | null>(null);

  const isEditMode = editing !== null;

  // O schema depende do tipo escolhido (lido do próprio form), então o resolver o consulta na hora da validação.
  const form = useForm<DynamicFormValues>({
    defaultValues: { name: "", id: "", type: "" },
    resolver: (values, context, options) => zodResolver(schema)(values, context, options),
  });
  const typeId = form.watch("type") as string;

  // Numa edição, a senha em branco mantém a atual: os campos "password" deixam de ser obrigatórios.
  const typeFields: FormFieldDef[] = useMemo(() => {
    const fields = types.find((t) => t.id === typeId)?.fields ?? [];
    return fields.map((f) => (f.type === "password" && isEditMode ? { ...f, required: false } : f));
  }, [types, typeId, isEditMode]);

  const schema = useMemo(() => baseSchema.extend(buildDynamicSchema(typeFields).shape), [typeFields]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [erpsRes, typesRes] = await Promise.all([api.erps.list(), api.erps.listTypes()]);
      setErps(erpsRes);
      setTypes(typesRes);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar ERPs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const typeLabel = (id: string) => types.find((t) => t.id === id)?.label ?? id;

  const openCreateSheet = () => {
    const first = types[0];
    setEditing(null);
    form.reset({ name: "", id: "", type: first?.id ?? "", ...buildDynamicDefaultValues(first?.fields ?? []) });
    setIsSheetOpen(true);
  };

  const openEditSheet = (erp: ErpConnection) => {
    const fields = types.find((t) => t.id === erp.type)?.fields ?? [];
    setEditing(erp);
    form.reset({
      ...buildDynamicDefaultValues(fields),
      ...erp.config,
      name: erp.name,
      id: erp.id,
      type: erp.type,
    });
    setIsSheetOpen(true);
  };

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
      toast.success(isEditMode ? "ERP atualizado com sucesso!" : "ERP cadastrado com sucesso!");
      setIsSheetOpen(false);
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar ERP");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (erp: ErpConnection) => {
    const ok = await api.erps.test(erp.id);
    if (ok) toast.success(`Conexão com '${erp.name}' estabelecida.`);
    else toast.error(`Não foi possível conectar em '${erp.name}'.`);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.erps.remove(deleteTarget.id);
      toast.success("ERP excluído.");
      setDeleteTarget(null);
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir ERP");
    }
  };

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
        <DropdownMenuItem onClick={() => openEditSheet(erp)} className="cursor-pointer">
          <Edit2 className="size-4 mr-2" />
          Editar ERP
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDeleteTarget(erp)} className="cursor-pointer text-destructive">
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

        <Button onClick={openCreateSheet} className="hidden lg:inline-flex shrink-0" disabled={types.length === 0}>
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
            <DropdownMenuItem onClick={openCreateSheet} className="cursor-pointer">
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">ERPs Cadastrados ({erps.length})</CardTitle>
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
                    fields={[
                      { label: "Tipo", value: <Skeleton className="h-5 w-20" /> },
                      { label: "Atualizado em", value: <Skeleton className="h-4 w-32" /> },
                    ]}
                  />
                ))
              ) : erps.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">Nenhum ERP cadastrado.</p>
              ) : (
                erps.map((erp) => (
                  <MobileCard
                    key={erp.id}
                    primary={erp.name}
                    secondary={erp.id}
                    fields={[
                      { label: "Tipo", value: <Badge variant="secondary">{typeLabel(erp.type)}</Badge> },
                      { label: "Atualizado em", value: formatDate(erp.updatedAt) },
                    ]}
                    actions={rowMenu(erp)}
                  />
                ))
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Identificador</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Atualizado em</TableHead>
                  <TableHead className="text-right w-20">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, idx) => (
                    <TableRow key={idx}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : erps.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                      Nenhum ERP cadastrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  erps.map((erp) => (
                    <TableRow key={erp.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-semibold">{erp.id}</TableCell>
                      <TableCell className="font-medium">{erp.name}</TableCell>
                      <TableCell><Badge variant="secondary">{typeLabel(erp.type)}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(erp.updatedAt)}</TableCell>
                      <TableCell className="text-right">{rowMenu(erp)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl">
          <SheetHeader className="p-6 border-b shrink-0">
            <SheetTitle>{isEditMode ? `Editar ERP: ${editing.name}` : "Novo ERP"}</SheetTitle>
            <SheetDescription>
              {isEditMode
                ? "Atualize os dados de conexão. Deixe a senha em branco para manter a atual."
                : "Escolha o tipo de ERP e informe os dados de conexão."}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0">
            <Form {...form}>
              <form
                id="erp-form"
                onSubmit={form.handleSubmit(handleSave)}
                className="p-6 flex flex-col gap-6"
                noValidate
              >
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de ERP</FormLabel>
                      <FormControl>
                        <Select
                          value={String(field.value ?? "")}
                          disabled={isEditMode}
                          onValueChange={(val: string | null) => handleTypeChange(val ?? "")}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o tipo" />
                          </SelectTrigger>
                          <SelectContent>
                            {types.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
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

                <DynamicFormFields fields={typeFields} form={form} />
              </form>
            </Form>
          </ScrollArea>

          <SheetFooter className="p-6 border-t shrink-0 flex flex-row justify-end gap-2 bg-popover">
            <Button type="button" variant="outline" onClick={() => setIsSheetOpen(false)}>
              Cancelar
            </Button>
            <Button form="erp-form" type="submit" disabled={saving}>
              {saving ? "Salvando..." : isEditMode ? "Salvar Alterações" : "Cadastrar ERP"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ERP</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              Excluir &quot;{deleteTarget?.name}&quot; ({deleteTarget?.id}) remove a conexão. Os Dashboards que usam
              essa fonte deixarão de carregar dados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-end">
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
