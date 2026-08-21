import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { WorkspaceRecord } from "@platform/shared";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { MobileCard } from "@/components/ui/mobile-card";
import { useIsMobile } from "@/hooks/use-mobile";
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
import {
  Calendar,
  ArrowRight,
  CheckCircle2,
  Clock,
  RefreshCw,
  Layers,
  Trash2,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";

export const WorkspacesPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const isMobile = useIsMobile();

  const canDelete = hasPermission("system:workspaces:delete");

  const fetchWorkspaces = async () => {
    try {
      setLoading(true);
      const data = await api.workspaces.list();
      setWorkspaces(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao listar áreas de trabalho";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const totalOpen = workspaces.filter((w) => w.status === "open").length;
  const totalClosed = workspaces.filter((w) => w.status === "closed").length;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await api.workspaces.remove(deleteTarget.id);
      setWorkspaces((prev) => prev.filter((w) => w.id !== deleteTarget.id));
      toast.success(`Área "${deleteTarget.name}" excluída com sucesso.`);
      setDeleteTarget(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao excluir Área de Trabalho.";
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <HeaderActions>
        <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={fetchWorkspaces} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </HeaderActions>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Áreas de Trabalho</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie e retome suas sessões de trabalho e fechamentos.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Áreas de Trabalho Abertas</CardTitle>
            <Clock className="size-4 text-sky-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-sky-500">
              {loading ? <Skeleton className="h-8 w-16" /> : totalOpen}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Concluídas</CardTitle>
            <CheckCircle2 className="size-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">
              {loading ? <Skeleton className="h-8 w-16" /> : totalClosed}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Áreas de Trabalho Iniciadas</CardTitle>
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
                      { label: "Modelo", value: <Skeleton className="h-4 w-24" /> },
                      { label: "Período", value: <Skeleton className="h-4 w-32" /> },
                      { label: "Status", value: <Skeleton className="h-5 w-20" /> },
                    ]}
                  />
                ))
              ) : workspaces.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">
                  <Layers className="size-6 mx-auto mb-2 text-muted-foreground/50" />
                  Nenhuma Área de Trabalho iniciada. Acesse um Modelo na barra lateral para criar.
                </p>
              ) : (
                workspaces.map((ws) => (
                  <MobileCard
                    key={ws.id}
                    primary={ws.name}
                    secondary={ws.id}
                    fields={[
                      { label: "Modelo", value: ws.recipeId },
                      {
                        label: "Período",
                        value: (
                          <span className="flex items-center gap-1.5">
                            <Calendar className="size-3 text-muted-foreground" />
                            {formatDate(ws.startDate)} até {formatDate(ws.endDate)}
                          </span>
                        ),
                      },
                      {
                        label: "Status",
                        value: ws.status === "closed" ? (
                          <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                            <CheckCircle2 className="size-3 text-emerald-500" />
                            Concluído
                          </Badge>
                        ) : (
                          <Badge variant="default" className="flex items-center gap-1 w-fit">
                            <Clock className="size-3" />
                            Aberto
                          </Badge>
                        ),
                      },
                    ]}
                    actions={
                      <div className="flex items-center gap-2">
                        {canDelete && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteTarget(ws)}
                            aria-label={`Excluir ${ws.name}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                        <Button
                          size="default"
                          variant="secondary"
                          onClick={() =>
                            navigate(`/workspaces/${ws.id}?start_date=${ws.startDate}&end_date=${ws.endDate}`)
                          }
                        >
                          Abrir
                          <ArrowRight className="size-4 ml-1" />
                        </Button>
                      </div>
                    }
                  />
                ))
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Identificador</TableHead>
                  <TableHead>Descrição / Título</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Período Temporal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, idx) => (
                    <TableRow key={idx}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : workspaces.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      <Layers className="size-8 mx-auto mb-2 text-muted-foreground/50" />
                      Nenhuma Área de Trabalho iniciada. Acesse um Modelo na barra lateral para criar.
                    </TableCell>
                  </TableRow>
                ) : (
                  workspaces.map((ws) => (
                    <TableRow key={ws.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-medium">{ws.id}</TableCell>
                      <TableCell className="font-medium">{ws.name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{ws.recipeId}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="size-3.5 text-muted-foreground" />
                          <span>
                            {formatDate(ws.startDate)} até {formatDate(ws.endDate)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {ws.status === "closed" ? (
                          <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                            <CheckCircle2 className="size-3 text-emerald-500" />
                            Concluído
                          </Badge>
                        ) : (
                          <Badge variant="default" className="flex items-center gap-1 w-fit">
                            <Clock className="size-3" />
                            Aberto
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {canDelete && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteTarget(ws)}
                              aria-label={`Excluir ${ws.name}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                          <Button
                            size="default"
                            variant="secondary"
                            onClick={() =>
                              navigate(`/workspaces/${ws.id}?start_date=${ws.startDate}&end_date=${ws.endDate}`)
                            }
                          >
                            Abrir
                            <ArrowRight className="size-4 ml-1" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Área de Trabalho?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A área{" "}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>{" "}
              <span className="font-mono text-xs">({deleteTarget?.id})</span> e todos os dados
              associados serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="default"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
