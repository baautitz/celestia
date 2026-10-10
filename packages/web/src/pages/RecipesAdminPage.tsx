import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { Skeleton } from "@/components/ui/skeleton";
import { MobileCard } from "@/components/ui/mobile-card";
import { useIsMobile } from "@/hooks/use-mobile";
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { PlusCircle, RefreshCw, MoreHorizontal, Edit2, Trash2, Download } from "lucide-react";
import { api } from "@/lib/api-client";
import { downloadSource } from "@/lib/utils";
import { HeaderActions } from "@/context/HeaderActionsContext";
import { useRecipesCatalog } from "@/context/RecipesCatalogContext";

const formatDate = (iso: string) => new Date(iso).toLocaleString("pt-BR");

export const RecipesAdminPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("system:recipes:manage");
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { refresh: refreshSidebar } = useRecipesCatalog();

  const [recipes, setRecipes] = useState<RecipeAdminSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<RecipeAdminSummary | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setRecipes(await api.recipeAdmin.list());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar Dashboards");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Relê os Dashboards do banco no servidor (pega edições feitas direto no Postgres) e atualiza a lista.
  const handleReload = async () => {
    try {
      setLoading(true);
      const result = await api.recipeAdmin.reload();
      if (result.errors.length > 0) {
        toast.error(`Não recarregados: ${result.errors.map((e) => `${e.id} (${e.message})`).join("; ")}`);
      } else {
        toast.success("Dashboards recarregados do banco.");
      }
      setRecipes(await api.recipeAdmin.list());
      refreshSidebar();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao recarregar Dashboards");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.recipeAdmin.remove(deleteTarget.id);
      toast.success("Dashboard excluído.");
      setDeleteTarget(null);
      fetchData();
      refreshSidebar();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir Dashboard");
    }
  };

  const handleDownload = async (recipe: RecipeAdminSummary) => {
    try {
      const record = await api.recipeAdmin.get(recipe.id);
      downloadSource(record.id, record.source);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao baixar o Dashboard");
    }
  };

  const rowMenu = (recipe: RecipeAdminSummary) => (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={canManage ? "Editar" : "Visualizar"}
        title={canManage ? "Editar" : "Visualizar"}
        nativeButton={false}
        render={<Link to={`/admin/dashboards/${recipe.id}/edit`} />}
      >
        <Edit2 className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Baixar .ts"
        title="Baixar .ts"
        onClick={() => handleDownload(recipe)}
      >
        <Download className="size-4" />
      </Button>
      {canManage && (
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive"
          aria-label="Excluir Dashboard"
          title="Excluir Dashboard"
          onClick={() => setDeleteTarget(recipe)}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </div>
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
          <Button onClick={() => navigate("/admin/dashboards/new")} className="hidden lg:inline-flex shrink-0">
            <PlusCircle className="size-3.5 mr-1.5" />
            Novo Dashboard
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
              <DropdownMenuItem onClick={() => navigate("/admin/dashboards/new")} className="cursor-pointer">
                <PlusCircle className="size-4 mr-2" />
                Novo Dashboard
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </HeaderActions>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboards</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cadastre e edite os Dashboards. São compilados e validados ao salvar.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Dashboards Cadastrados ({recipes.length})</CardTitle>
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
                <p className="text-center py-8 text-muted-foreground text-sm">Nenhum Dashboard cadastrado.</p>
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
                  <TableHead className="text-right w-36">Ações</TableHead>
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
                      Nenhum Dashboard cadastrado.
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

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Dashboard</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              Excluir &quot;{deleteTarget?.name || deleteTarget?.id}&quot; ({deleteTarget?.id}) remove o Dashboard e as
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
