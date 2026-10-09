import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { RecipeAdminSummary } from "@platform/shared";
import { useAuth } from "@/context/AuthContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FieldLabel } from "@/components/ui/field";
import { MobileCard } from "@/components/ui/mobile-card";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { PlusCircle, RefreshCw, MoreHorizontal, Edit2, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";
import { useRecipesCatalog } from "@/context/RecipesCatalogContext";

const formSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "Use letras minúsculas, números e _ (ex.: fechamento_mes)."),
  source: z.string().min(1, "Cole o código do Modelo ou carregue um arquivo .ts."),
});

type FormValues = z.infer<typeof formSchema>;

const formatDate = (iso: string) => new Date(iso).toLocaleString("pt-BR");

export const RecipesAdminPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("system:recipes:manage");
  const isMobile = useIsMobile();
  const { refresh: refreshSidebar } = useRecipesCatalog();

  const [recipes, setRecipes] = useState<RecipeAdminSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecipeAdminSummary | null>(null);

  const isEditMode = editingId !== null;
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { id: "", source: "" },
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setRecipes(await api.recipeAdmin.list());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar Modelos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Relê os Modelos do banco no servidor (pega edições feitas direto no Postgres) e atualiza a lista.
  const handleReload = async () => {
    try {
      setLoading(true);
      const result = await api.recipeAdmin.reload();
      if (result.errors.length > 0) {
        toast.error(`Não recarregados: ${result.errors.map((e) => `${e.id} (${e.message})`).join("; ")}`);
      } else {
        toast.success("Modelos recarregados do banco.");
      }
      setRecipes(await api.recipeAdmin.list());
      refreshSidebar();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao recarregar Modelos");
    } finally {
      setLoading(false);
    }
  };

  const openCreateSheet = () => {
    setEditingId(null);
    form.reset({ id: "", source: "" });
    setIsSheetOpen(true);
  };

  const openEditSheet = async (summary: RecipeAdminSummary) => {
    try {
      const record = await api.recipeAdmin.get(summary.id);
      setEditingId(record.id);
      form.reset({ id: record.id, source: record.source });
      setIsSheetOpen(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar o código do Modelo");
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    form.setValue("source", text, { shouldValidate: true });
    // O id do Modelo costuma ser o primeiro `id: "..."` do arquivo; só preenche se estiver vazio.
    if (!form.getValues("id")) {
      const match = text.match(/\bid:\s*["']([a-z][a-z0-9_]*)["']/);
      if (match?.[1]) form.setValue("id", match[1], { shouldValidate: true });
    }
    e.target.value = "";
  };

  const handleSave = async (values: FormValues) => {
    try {
      setSaving(true);
      await api.recipeAdmin.save(values.id, values.source);
      toast.success(isEditMode ? "Modelo atualizado com sucesso!" : "Modelo cadastrado com sucesso!");
      setIsSheetOpen(false);
      fetchData();
      refreshSidebar();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar Modelo");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.recipeAdmin.remove(deleteTarget.id);
      toast.success("Modelo excluído.");
      setDeleteTarget(null);
      fetchData();
      refreshSidebar();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir Modelo");
    }
  };

  const rowMenu = (recipe: RecipeAdminSummary) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => openEditSheet(recipe)} className="cursor-pointer">
          <Edit2 className="size-4 mr-2" />
          {canManage ? "Editar código" : "Ver código"}
        </DropdownMenuItem>
        {canManage && (
          <DropdownMenuItem onClick={() => setDeleteTarget(recipe)} className="cursor-pointer text-destructive">
            <Trash2 className="size-4 mr-2" />
            Excluir Modelo
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex flex-col gap-6">
      <HeaderActions>
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          onClick={canManage ? handleReload : fetchData}
          disabled={loading}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>

        {canManage && (
          <Button onClick={openCreateSheet} className="hidden lg:inline-flex shrink-0">
            <PlusCircle className="size-3.5 mr-1.5" />
            Novo Modelo
          </Button>
        )}

        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon" className="size-8 shrink-0 lg:hidden" />}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openCreateSheet} className="cursor-pointer">
                <PlusCircle className="size-4 mr-2" />
                Novo Modelo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </HeaderActions>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Modelos (Código)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cadastre e edite os Modelos em TypeScript. O código é compilado e validado ao salvar.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Modelos Cadastrados ({recipes.length})</CardTitle>
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
                    fields={[{ label: "Atualizado em", value: <Skeleton className="h-4 w-32" /> }]}
                  />
                ))
              ) : recipes.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">Nenhum Modelo cadastrado.</p>
              ) : (
                recipes.map((recipe) => (
                  <MobileCard
                    key={recipe.id}
                    primary={recipe.name || recipe.id}
                    secondary={recipe.id}
                    fields={[{ label: "Atualizado em", value: formatDate(recipe.updatedAt) }]}
                    actions={rowMenu(recipe)}
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
                  <TableHead>Atualizado em</TableHead>
                  <TableHead className="text-right w-20">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, idx) => (
                    <TableRow key={idx}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : recipes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                      Nenhum Modelo cadastrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  recipes.map((recipe) => (
                    <TableRow key={recipe.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-semibold">{recipe.id}</TableCell>
                      <TableCell className="font-medium">{recipe.name || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(recipe.updatedAt)}</TableCell>
                      <TableCell className="text-right">{rowMenu(recipe)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="right" className="flex flex-col p-0 sm:max-w-3xl">
          <SheetHeader className="p-6 border-b shrink-0">
            <SheetTitle>{isEditMode ? `Modelo: ${editingId}` : "Novo Modelo"}</SheetTitle>
            <SheetDescription>
              {canManage
                ? "Cole o código TypeScript do Modelo (defineRecipe) ou carregue um arquivo .ts."
                : "Código-fonte do Modelo (somente leitura)."}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0">
            <Form {...form}>
              <form
                id="recipe-form"
                onSubmit={form.handleSubmit(handleSave)}
                className="p-6 flex flex-col gap-6"
                noValidate
              >
                {canManage && (
                  <Field>
                    <FieldLabel htmlFor="recipe-file">Carregar arquivo .ts</FieldLabel>
                    <Input id="recipe-file" type="file" accept=".ts,text/plain" onChange={handleFile} />
                  </Field>
                )}

                <FormField
                  control={form.control}
                  name="id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Identificador do Modelo</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="fechamento_mes"
                          value={field.value}
                          disabled={isEditMode || !canManage}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormDescription>Deve ser igual ao `id` declarado dentro do código.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Código (TypeScript)</FormLabel>
                      <FormControl>
                        <Textarea
                          className="min-h-96 font-mono text-xs"
                          spellCheck={false}
                          value={field.value}
                          readOnly={!canManage}
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
              </form>
            </Form>
          </ScrollArea>

          <SheetFooter className="p-6 border-t shrink-0 flex flex-row justify-end gap-2 bg-popover">
            <Button type="button" variant="outline" onClick={() => setIsSheetOpen(false)}>
              {canManage ? "Cancelar" : "Fechar"}
            </Button>
            {canManage && (
              <Button form="recipe-form" type="submit" disabled={saving}>
                {saving ? "Compilando e salvando..." : isEditMode ? "Salvar Alterações" : "Cadastrar Modelo"}
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Modelo</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              Excluir &quot;{deleteTarget?.name || deleteTarget?.id}&quot; ({deleteTarget?.id}) remove o Modelo e as
              permissões dele dos grupos. As Áreas de Trabalho que o usam deixarão de abrir.
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
