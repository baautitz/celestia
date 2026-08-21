import React, { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import type { DashboardSchemaResponse, WorkspaceRecord } from "@platform/shared";
import { useAuth } from "@/context/AuthContext";
import { SDUIRenderer } from "@/components/sdui/SDUIRenderer";
import { DynamicFormFields } from "@/components/forms/DynamicFormFields";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  buildDynamicDefaultValues,
  buildDynamicSchema,
  normalizeDynamicFormValues,
} from "@/lib/dynamic-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { FieldGroup } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { useImperativeUI } from "@/context/ImperativeUIContext";
import { toast } from "@/components/ui/toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { HeaderActions } from "@/context/HeaderActionsContext";
import type { DateRange } from "react-day-picker";
import {
  RefreshCw,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Clock,
  Lock,
  RotateCcw,
  Settings,
} from "lucide-react";

export const WorkspaceDetailPage: React.FC = () => {
  const { id: workspaceId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { triggerRefresh, confirm } = useImperativeUI();

  const [schema, setSchema] = useState<DashboardSchemaResponse | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [concluding, setConcluding] = useState(false);

  const initialStartDate = searchParams.get("start_date") || workspaceInfo?.startDate || "2026-01-01";
  const initialEndDate = searchParams.get("end_date") || workspaceInfo?.endDate || "2026-01-31";

  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);

  // Estado do dialog de edição de parâmetros
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    // Busca o workspace primeiro, depois o schema pelo recipeId correto
    (workspaceId ? api.workspaces.get(workspaceId) : Promise.resolve(null))
      .then(async (wsRes) => {
        if (!isMounted) return;
        if (wsRes) {
          setWorkspaceInfo(wsRes);
          setStartDate(wsRes.startDate);
          setEndDate(wsRes.endDate);
        }

        const recipeId = wsRes?.recipeId || "fechamento_mes";
        try {
          const schemaRes = await api.dashboards.getSchema(recipeId);
          if (isMounted) setSchema(schemaRes);
        } catch (err: unknown) {
          if (isMounted) setError(err instanceof Error ? err.message : "Erro ao carregar o Modelo.");
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Erro ao carregar dados da Área de Trabalho.");
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [workspaceId]);

  // Schema dinâmico para o formulário de edição
  const editFields = schema?.workspace?.params || [];
  const editSchema = buildDynamicSchema(editFields);
  const editDefaults = buildDynamicDefaultValues(editFields);

  const editForm = useForm<Record<string, unknown>>({
    resolver: zodResolver(editSchema),
    defaultValues: editDefaults,
  });

  const handleConcludeWorkspace = async () => {
    if (!workspaceId) return;

    const confirmed = await confirm({
      title: "Concluir Área de Trabalho",
      message:
        "Tem certeza que deseja finalizar esta Área de Trabalho? Ela será preservada para auditoria e novas ações operacionais serão bloqueadas.",
    });

    if (!confirmed) return;

    try {
      setConcluding(true);
      const res = await api.workspaces.conclude(workspaceId);
      setWorkspaceInfo(res.workspace);
      toast.success("Área de Trabalho concluída com sucesso!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao concluir Área de Trabalho.";
      toast.error(msg);
    } finally {
      setConcluding(false);
    }
  };

  const handleReopenWorkspace = async () => {
    if (!workspaceId) return;

    const confirmed = await confirm({
      title: "Reabrir Área de Trabalho",
      message: "Deseja reabrir esta Área de Trabalho para novas alterações e auditorias?",
    });

    if (!confirmed) return;

    try {
      setConcluding(true);
      const res = await api.workspaces.reopen(workspaceId);
      setWorkspaceInfo(res.workspace);
      toast.success("Área de Trabalho reaberta!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao reabrir Área de Trabalho.";
      toast.error(msg);
    } finally {
      setConcluding(false);
    }
  };

  // Abre o dialog de edição com os valores atuais preenchidos
  const handleOpenEdit = () => {
    if (!workspaceInfo) return;

    const currentParams: Record<string, unknown> = {
      name: workspaceInfo.name,
      dateRange: {
        from: new Date(workspaceInfo.startDate),
        to: new Date(workspaceInfo.endDate),
      },
      ...(workspaceInfo.params || {}),
    };

    editForm.reset(currentParams);
    setEditOpen(true);
  };

  // Salva as edições de parâmetros
  const handleSaveEdit = async (data: Record<string, unknown>) => {
    if (!workspaceId) return;

    const name = (data.name as string) || "";
    const range = data.dateRange as DateRange | undefined;
    const newStartDate = range?.from ? range.from.toISOString().slice(0, 10) : workspaceInfo?.startDate || "";
    const newEndDate = range?.to ? range.to.toISOString().slice(0, 10) : workspaceInfo?.endDate || "";

    if (newEndDate < newStartDate) {
      toast.error("A Data Final não pode ser anterior à Data Inicial.");
      return;
    }

    try {
      setSaving(true);
      // Normaliza os params extras (exclui name/dateRange que são campos diretos)
      const paramsData: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(data)) {
        if (key !== "name" && key !== "dateRange") {
          paramsData[key] = val;
        }
      }
      const normalizedParams = normalizeDynamicFormValues(editFields, paramsData);

      const updated = await api.workspaces.update(workspaceId, {
        name: name || undefined,
        startDate: newStartDate,
        endDate: newEndDate,
        params: Object.keys(normalizedParams).length > 0 ? normalizedParams : undefined,
      });

      setWorkspaceInfo(updated);
      setStartDate(newStartDate);
      setEndDate(newEndDate);
      setSearchParams({ start_date: newStartDate, end_date: newEndDate });
      setEditOpen(false);
      triggerRefresh();
      toast.success("Parâmetros atualizados com sucesso!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar parâmetros.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-72" />
        </div>
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-6">
            <Skeleton className="h-32 w-full" />
          </div>
          <div className="col-span-12 md:col-span-6">
            <Skeleton className="h-32 w-full" />
          </div>
          <div className="col-span-12">
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !schema) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>Erro ao carregar Modelo</AlertTitle>
        <AlertDescription>{error || "Definição de modelo não encontrada."}</AlertDescription>
      </Alert>
    );
  }

  const isClosed = workspaceInfo?.status === "closed";

  return (
    <div className="flex flex-col gap-6">
      {/* Banner de Aviso quando Concluído */}
      {isClosed && (
        <Alert>
          <Lock className="size-4 text-primary" />
          <AlertTitle>Área de Trabalho Concluída</AlertTitle>
          <AlertDescription>
            Esta sessão de apuração foi finalizada. Os dados estão preservados em modo leitura e bloqueados para novas ações operacionais.
          </AlertDescription>
        </Alert>
      )}

      {/* Ações do Header Global */}
      <HeaderActions>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => triggerRefresh()}
          title="Atualizar dados"
        >
          <RefreshCw className="size-4" />
        </Button>

        {!isClosed && hasPermission("system:workspaces:update") && (
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={handleOpenEdit}
          >
            <Settings className="size-4 mr-2" />
            Editar Parâmetros
          </Button>
        )}

        {isClosed
          ? hasPermission("system:workspaces:reopen") && (
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={handleReopenWorkspace}
                disabled={concluding}
              >
                <RotateCcw className="size-4 mr-2" />
                Reabrir Área
              </Button>
            )
          : hasPermission("system:workspaces:close") && (
              <Button
                type="button"
                variant="default"
                size="default"
                onClick={handleConcludeWorkspace}
                disabled={concluding}
              >
                <CheckCircle2 className="size-4 mr-2" />
                Concluir Fechamento
              </Button>
            )}
      </HeaderActions>

      {/* Título da Página */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/workspaces")}
          title="Voltar para a lista"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">{workspaceInfo?.name || schema.name}</h1>
            <Badge variant="outline" className="font-mono text-xs">
              {workspaceId}
            </Badge>
            {isClosed ? (
              <Badge variant="secondary" className="flex items-center gap-1">
                <CheckCircle2 className="size-3 text-emerald-500" /> Concluído
              </Badge>
            ) : (
              <Badge variant="default" className="flex items-center gap-1">
                <Clock className="size-3" /> Aberto
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{schema.description}</p>
        </div>
      </div>

      {/* Renderizador SDUI — modo Área de Trabalho (ações ativas) */}
      <SDUIRenderer
        schema={schema}
        workspaceId={workspaceId || "default"}
        startDate={startDate}
        endDate={endDate}
        isWorkspaceClosed={isClosed}
      />

      {/* Dialog de Edição de Parâmetros */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleSaveEdit)}>
              <DialogHeader>
                <DialogTitle>Editar Parâmetros da Área de Trabalho</DialogTitle>
                <DialogDescription>
                  Altere o título, período ou parâmetros adicionais. As mudanças afetam os dados exibidos e as ações executadas.
                </DialogDescription>
              </DialogHeader>

              <FieldGroup className="py-4">
                <FormField
                  control={editForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Título / Descrição</FormLabel>
                      <FormControl>
                        <Input
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
                  control={editForm.control}
                  name="dateRange"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Período</FormLabel>
                      <FormControl>
                        <DateRangePicker
                          value={field.value as DateRange | undefined}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {editFields.length > 0 && (
                  <DynamicFormFields fields={editFields} form={editForm} recipeId={workspaceInfo?.recipeId || ""} />
                )}
              </FieldGroup>

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" size="default" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar Alterações"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
