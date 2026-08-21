import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { FieldGroup } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { HeaderActions } from "@/context/HeaderActionsContext";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { DateRange } from "react-day-picker";
import {
  ArrowLeft,
  AlertCircle,
  RefreshCw,
  Play,
  Shield,
  MoreHorizontal,
} from "lucide-react";
import { RecipePermissionsSheet } from "@/components/recipes/RecipePermissionsSheet";

export const RecipeDashboardPage: React.FC = () => {
  const { recipeId } = useParams<{ recipeId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  const [schema, setSchema] = useState<DashboardSchemaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: firstDay,
    to: lastDay,
  });

  // Converte DateRange para strings YYYY-MM-DD
  const startDate = dateRange?.from
    ? dateRange.from.toISOString().slice(0, 10)
    : firstDay.toISOString().slice(0, 10);
  const endDate = dateRange?.to
    ? dateRange.to.toISOString().slice(0, 10)
    : lastDay.toISOString().slice(0, 10);

  // Estado do dialog de inicialização
  const [initOpen, setInitOpen] = useState(false);
  const [existingSession, setExistingSession] = useState<WorkspaceRecord | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [permSheetOpen, setPermSheetOpen] = useState(false);

  // Carrega schema + workspaces existentes para detectar duplicatas
  const fetchData = async () => {
    if (!recipeId) return;
    try {
      setLoading(true);
      setError(null);
      const schemaRes = await api.dashboards.getSchema(recipeId);
      setSchema(schemaRes);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao carregar o Modelo.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [recipeId]);

  // Schema dinâmico para o formulário de inicialização
  const initFields = schema?.workspace?.params || [];
  const initSchema = buildDynamicSchema(initFields);
  const initDefaults = buildDynamicDefaultValues(initFields);

  const initForm = useForm<Record<string, unknown>>({
    resolver: zodResolver(initSchema),
    defaultValues: initDefaults,
  });

  // Abre o dialog de inicialização
  const handleOpenInit = async () => {
    if (!recipeId || !schema) return;

    // Verifica duplicatas: workspace open com mesmo modelo + mesmo período
    try {
      const existing = await api.workspaces.list(recipeId);
      const duplicate = existing.find(
        (ws) => ws.status === "open" && ws.startDate === startDate && ws.endDate === endDate
      );

      if (duplicate) {
        setExistingSession(duplicate);
        setDuplicateOpen(true);
      } else {
        // Reseta o formulário e abre o dialog
        initForm.reset(buildDynamicDefaultValues(initFields));
        setInitOpen(true);
      }
    } catch {
      // Se a listagem falhar, abre o dialog mesmo assim
      initForm.reset(buildDynamicDefaultValues(initFields));
      setInitOpen(true);
    }
  };

  // Cria a Área de Trabalho
  const handleCreate = async (data: Record<string, unknown>) => {
    if (!recipeId) return;

    try {
      setCreating(true);
      const normalizedParams = normalizeDynamicFormValues(initFields, data);
      const title = (data.name as string) || "";

      const ws = await api.workspaces.create({
        recipeId,
        startDate,
        endDate,
        name: title || undefined,
        params: Object.keys(normalizedParams).length > 0 ? normalizedParams : undefined,
      });

      toast.success("Área de Trabalho inicializada com sucesso!");
      setInitOpen(false);
      navigate(`/workspaces/${ws.id}?start_date=${ws.startDate}&end_date=${ws.endDate}`, { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao criar Área de Trabalho.";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  // Navega para sessão existente
  const handleGoToExisting = () => {
    if (!existingSession) return;
    setDuplicateOpen(false);
    navigate(`/workspaces/${existingSession.id}?start_date=${existingSession.startDate}&end_date=${existingSession.endDate}`, { replace: true });
  };

  // Abre o dialog para criar uma nova sessão ignorando a existente
  const handleCreateAnyway = () => {
    setDuplicateOpen(false);
    initForm.reset(buildDynamicDefaultValues(initFields));
    setInitOpen(true);
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
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
        <AlertDescription>{error || "Modelo não encontrado."}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Ações do Header Global */}
      <HeaderActions>
        <DateRangePicker
          value={dateRange}
          onChange={setDateRange}
          className="hidden sm:inline-flex"
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={fetchData}
          title="Atualizar dados"
          className="size-8 shrink-0"
        >
          <RefreshCw className="size-4" />
        </Button>

        {hasPermission("system:workspaces:create") && (
          <Button type="button" size="default" onClick={handleOpenInit} className="hidden md:inline-flex shrink-0">
            <Play className="size-4 mr-2" />
            Inicializar Área de Trabalho
          </Button>
        )}

        {hasPermission("system:roles:update") && (
          <Button type="button" variant="outline" size="default" onClick={() => setPermSheetOpen(true)} className="hidden md:inline-flex shrink-0">
            <Shield className="size-4 mr-2" />
            Permissões
          </Button>
        )}

        {/* Dropdown mobile */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="outline" size="icon" className="size-8 shrink-0 md:hidden" />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hasPermission("system:workspaces:create") && (
              <DropdownMenuItem onClick={handleOpenInit}>
                <Play className="size-4" />
                Inicializar Área de Trabalho
              </DropdownMenuItem>
            )}
            {hasPermission("system:roles:update") && (
              <DropdownMenuItem onClick={() => setPermSheetOpen(true)}>
                <Shield className="size-4" />
                Permissões
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </HeaderActions>

      {/* Título da Página */}
      <div className="flex items-start gap-2 md:gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/workspaces")}
          title="Voltar para a lista"
          className="mt-1 shrink-0 size-8 md:size-10"
        >
          <ArrowLeft className="size-4 md:size-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">{schema.name}</h1>
            <Badge variant="secondary" className="font-mono text-xs px-2 py-0.5 hidden sm:inline-flex">
              {recipeId}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{schema.description}</p>
        </div>
      </div>

      {/* SDUI Renderer — modo leitura */}
      <SDUIRenderer
        schema={schema}
        workspaceId="preview"
        startDate={startDate}
        endDate={endDate}
        readOnly
      />

      {/* Dialog de Inicialização */}
      <Dialog open={initOpen} onOpenChange={setInitOpen}>
        <DialogContent className="sm:max-w-md">
          <Form {...initForm}>
            <form onSubmit={initForm.handleSubmit(handleCreate)}>
              <DialogHeader>
                <DialogTitle>Inicializar Área de Trabalho</DialogTitle>
                <DialogDescription>
                  Defina um título e os parâmetros adicionais para a sessão de trabalho.
                  O período ({startDate} até {endDate}) será aplicado conforme o filtro acima.
                </DialogDescription>
              </DialogHeader>

              <FieldGroup className="py-4">
                <FormField
                  control={initForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Título / Descrição</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={`Ex: ${schema.name} — ${startDate} a ${endDate}`}
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

                {initFields.length > 0 && (
                  <DynamicFormFields fields={initFields} form={initForm} recipeId={recipeId!} />
                )}
              </FieldGroup>

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setInitOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" size="default" disabled={creating}>
                  {creating ? "Criando..." : "Criar e Abrir"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Dialog de Duplicata Detectada */}
      <AlertDialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Sessão já existe para este período</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              Já existe uma Área de Trabalho aberta para o Modelo &quot;{schema.name}&quot; com o período de{" "}
              <span className="font-medium text-foreground">{existingSession?.startDate}</span> até{" "}
              <span className="font-medium text-foreground">{existingSession?.endDate}</span>{" "}
              <span className="font-mono text-xs break-all">({existingSession?.id})</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-end">
            <AlertDialogCancel onClick={() => setDuplicateOpen(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={handleCreateAnyway}>
              Criar nova mesmo assim
            </AlertDialogAction>
            <AlertDialogAction onClick={handleGoToExisting}>Abrir a existente</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sheet de Permissões do Modelo */}
      {recipeId && (
        <RecipePermissionsSheet
          recipeId={recipeId}
          open={permSheetOpen}
          onOpenChange={setPermSheetOpen}
        />
      )}
    </div>
  );
};
