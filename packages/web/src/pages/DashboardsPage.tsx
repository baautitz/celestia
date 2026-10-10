import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Layers } from "lucide-react";
import { useRecipesCatalog } from "@/context/RecipesCatalogContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MobileCard } from "@/components/ui/mobile-card";

export const DashboardsPage: React.FC = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { recipes, loading } = useRecipesCatalog();

  const openButton = (id: string) => (
    <Button variant="outline" onClick={() => navigate(`/dashboards/${id}`)}>
      Abrir
      <ArrowRight className="size-4 ml-1" />
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboards</h1>
        <p className="text-sm text-muted-foreground mt-1">Escolha um Dashboard para visualizar ou iniciar uma Área de Trabalho.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Dashboards Disponíveis ({recipes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isMobile ? (
            <div className="flex flex-col gap-3">
              {loading ? (
                Array.from({ length: 3 }).map((_, idx) => (
                  <MobileCard
                    key={idx}
                    primary=""
                    fields={[{ label: "Descrição", value: <Skeleton className="h-4 w-32" /> }]}
                  />
                ))
              ) : recipes.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">Nenhum Dashboard disponível.</p>
              ) : (
                recipes.map((recipe) => (
                  <MobileCard
                    key={recipe.id}
                    primary={recipe.name}
                    secondary={recipe.id}
                    fields={[{ label: "Descrição", value: recipe.description || "-" }]}
                    actions={openButton(recipe.id)}
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
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, idx) => (
                    <TableRow key={idx}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-64" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : recipes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                      <Layers className="size-8 mx-auto mb-2 text-muted-foreground/50" />
                      Nenhum Dashboard disponível.
                    </TableCell>
                  </TableRow>
                ) : (
                  recipes.map((recipe) => (
                    <TableRow key={recipe.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-medium">{recipe.id}</TableCell>
                      <TableCell className="font-medium">{recipe.name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{recipe.description || "-"}</TableCell>
                      <TableCell className="text-right">{openButton(recipe.id)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
