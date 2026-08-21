import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { Role, PermissionCatalog, PermissionItem } from "@platform/shared";
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
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";
import { MobileCard } from "@/components/ui/mobile-card";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import {
  Shield,
  PlusCircle,
  RefreshCw,
  MoreHorizontal,
  Edit2,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";

export const IAMRolesPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [loading, setLoading] = useState(true);

  // Drawer / Sheet State
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);

  // Form State
  const [roleName, setRoleName] = useState("");
  const [roleSlug, setRoleSlug] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();

  const fetchData = async () => {
    try {
      setLoading(true);
      const [rolesRes, catalogRes] = await Promise.all([
        api.iam.listRoles(),
        api.iam.getCatalog(),
      ]);
      setRoles(rolesRes);
      setCatalog(catalogRes);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao carregar perfis de acesso";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreateSheet = () => {
    setIsEditMode(false);
    setEditingRoleId(null);
    setRoleName("");
    setRoleSlug("");
    setRoleDescription("");
    setSelectedPermissions([]);
    setIsSheetOpen(true);
  };

  const openEditSheet = (r: Role) => {
    setIsEditMode(true);
    setEditingRoleId(r.id);
    setRoleName(r.name);
    setRoleSlug(r.id);
    setRoleDescription(r.description || "");
    setSelectedPermissions([...r.permissions]);
    setIsSheetOpen(true);
  };

  const handleTogglePermission = (key: string, enabled: boolean) => {
    if (enabled) {
      setSelectedPermissions((prev) => [...prev.filter((p) => p !== key && p !== "*"), key]);
    } else {
      setSelectedPermissions((prev) => prev.filter((p) => p !== key && p !== "*"));
    }
  };

  const isPermActive = (key: string): boolean => {
    return selectedPermissions.includes("*") || selectedPermissions.includes(key);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      const cleanSlug = roleSlug.trim().toLowerCase().replace(/\s+/g, "_");

      if (isEditMode && editingRoleId) {
        await api.iam.updateRole(editingRoleId, {
          name: roleName.trim(),
          description: roleDescription.trim(),
          permissions: selectedPermissions,
        });
        toast.success("Perfil de acesso atualizado com sucesso!");
      } else {
        await api.iam.createRole({
          id: cleanSlug,
          name: roleName.trim(),
          description: roleDescription.trim(),
          permissions: selectedPermissions,
        });
        toast.success("Perfil de acesso criado com sucesso!");
      }

      setIsSheetOpen(false);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao salvar perfil";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <HeaderActions>
        <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>

        {hasPermission("system:roles:create") && (
          <Button onClick={openCreateSheet} className="hidden lg:inline-flex shrink-0">
            <PlusCircle className="size-3.5 mr-1.5" />
            Novo Grupo
          </Button>
        )}

        {hasPermission("system:roles:create") && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon" className="size-8 shrink-0 lg:hidden" />}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openCreateSheet} className="cursor-pointer">
                <PlusCircle className="size-4 mr-2" />
                Novo Grupo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </HeaderActions>

      {/* Top Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Grupos & Perfis de Acesso</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie permissões granulares no modelo Permission-First.
        </p>
      </div>

      {/* Tabela de Grupos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Grupos Registrados ({roles.length})
          </CardTitle>
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
                      { label: "Descrição", value: <Skeleton className="h-4 w-40" /> },
                      { label: "Permissões", value: <Skeleton className="h-5 w-20" /> },
                    ]}
                  />
                ))
              ) : roles.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">
                  Nenhum grupo de acesso cadastrado.
                </p>
              ) : (
                roles.map((r) => (
                  <MobileCard
                    key={r.id}
                    primary={r.name}
                    secondary={r.id}
                    fields={[
                      { label: "Descrição", value: r.description || "-" },
                      {
                        label: "Permissões",
                        value: (
                          <Badge variant="secondary">
                            {r.permissions.includes("*") ? "Acesso Total (*)" : `${r.permissions.length} permissões`}
                          </Badge>
                        ),
                      },
                    ]}
                    actions={
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {hasPermission("system:roles:update") && (
                            <DropdownMenuItem onClick={() => openEditSheet(r)} className="cursor-pointer">
                              <Edit2 className="size-4 mr-2" />
                              Editar Grupo & Permissões
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    }
                  />
                ))
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Identificador (Slug)</TableHead>
                  <TableHead>Nome do Grupo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Permissões Ativas</TableHead>
                  <TableHead className="text-right w-20">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, idx) => (
                    <TableRow key={idx}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-56" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : roles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                      Nenhum grupo de acesso cadastrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  roles.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-semibold">{r.id}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.description || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {r.permissions.includes("*") ? "Acesso Total (*)" : `${r.permissions.length} permissões`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {hasPermission("system:roles:update") && (
                              <DropdownMenuItem onClick={() => openEditSheet(r)} className="cursor-pointer">
                                <Edit2 className="size-4 mr-2" />
                                Editar Grupo & Permissões
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Drawer Lateral */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl">
          <SheetHeader className="p-6 border-b shrink-0">
            <SheetTitle>{isEditMode ? `Editar Grupo: ${roleName}` : "Novo Grupo de Acesso"}</SheetTitle>
            <SheetDescription>
              Configure os dados básicos do grupo e selecione as permissões atribuídas.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0">
            <form
              id="role-form"
              onSubmit={handleSaveRole}
              className="p-6 flex flex-col gap-6"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="r-name">Nome do Grupo</FieldLabel>
                  <Input
                    id="r-name"
                    placeholder="Ex: Auditor Financeiro"
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    required
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="r-slug">Identificador do Grupo (slug)</FieldLabel>
                  <Input
                    id="r-slug"
                    placeholder="auditor_financeiro"
                    value={roleSlug}
                    onChange={(e) => setRoleSlug(e.target.value)}
                    disabled={isEditMode}
                    required
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="r-desc">Descrição</FieldLabel>
                  <Textarea
                    id="r-desc"
                    placeholder="Descreva a finalidade e escopo de acesso deste grupo..."
                    value={roleDescription}
                    onChange={(e) => setRoleDescription(e.target.value)}
                  />
                </Field>
              </FieldGroup>

              {/* Matriz de Permissões: Módulos de Sistema (system:*) */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Shield className="size-3.5 text-primary" />
                    Módulos de Sistema
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {catalog &&
                    Object.entries(catalog.system).map(([moduleName, perms]) => (
                      <div key={moduleName} className="flex flex-col gap-2">
                        <div className="bg-muted/60 py-0.5 text-xs font-semibold uppercase tracking-wider text-foreground">
                          Módulo: {moduleName}
                        </div>
                        <div className="flex flex-col divide-y divide-border/40">
                          {perms.map((p: PermissionItem) => (
                            <div key={p.key} className="flex items-center justify-between gap-4 py-2">
                              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                <span className="font-mono text-xs font-medium text-foreground break-all">{p.key}</span>
                                {p.description && (
                                  <span className="text-[11px] text-muted-foreground">{p.description}</span>
                                )}
                              </div>
                              <Switch
                                className="shrink-0"
                                checked={isPermActive(p.key)}
                                onCheckedChange={(checked: boolean) => handleTogglePermission(p.key, checked)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </CardContent>
              </Card>

              <p className="text-xs text-muted-foreground">
                Permissões de Modelos são configuradas diretamente na página de cada Modelo.
              </p>
            </form>
          </ScrollArea>

          <SheetFooter className="p-6 border-t shrink-0 flex flex-row justify-end gap-2 bg-popover">
            <Button type="button" variant="outline" onClick={() => setIsSheetOpen(false)}>
              Cancelar
            </Button>
            <Button form="role-form" type="submit" disabled={saving}>
              {saving ? "Salvando..." : isEditMode ? "Salvar Alterações" : "Criar Grupo"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
};
