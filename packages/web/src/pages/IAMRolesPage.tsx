import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import type { Role, PermissionCatalog, PermissionItem } from "@platform/shared";
import { Card, CardHeader, CardTitle, CardContent } from "@platform/ui/components/card";
import { Button } from "@platform/ui/components/button";
import { Input } from "@platform/ui/components/input";
import { Textarea } from "@platform/ui/components/textarea";
import { Badge } from "@platform/ui/components/badge";
import { Switch } from "@platform/ui/components/switch";
import { FieldGroup } from "@platform/ui/components/field";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@platform/ui/components/form";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@platform/ui/components/dropdown-menu";
import { DataTable } from "@platform/ui/data-table/data-table";
import type { DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { useWindow, WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import {
  Shield,
  PlusCircle,
  RefreshCw,
  MoreHorizontal,
  Edit2,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";

const roleSchema = z.object({
  name: z.string().min(1, "Informe o nome do grupo"),
  slug: z.string().min(1, "Informe o identificador do grupo"),
  description: z.string(),
  permissions: z.array(z.string()),
});
type RoleFormValues = z.infer<typeof roleSchema>;

interface RoleSheetProps {
  role: Role | null;
  catalog: PermissionCatalog | null;
}

const RoleSheetContent: React.FC<RoleSheetProps> = ({ role, catalog }) => {
  const { resolve, setTitle } = useWindow<true>();
  const { feedback } = useUi();
  const isEditMode = role !== null;
  const [saving, setSaving] = useState(false);
  const form = useForm<RoleFormValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: {
      name: role?.name ?? "",
      slug: role?.id ?? "",
      description: role?.description || "",
      permissions: role ? [...role.permissions] : [],
    },
  });

  const name = form.watch("name");
  useEffect(() => {
    if (isEditMode) setTitle(`Editar Grupo: ${name}`);
  }, [isEditMode, name, setTitle]);

  const onSubmit = async (v: RoleFormValues) => {
    try {
      setSaving(true);
      const cleanSlug = v.slug.trim().toLowerCase().replace(/\s+/g, "_");
      if (role) {
        await api.iam.updateRole(role.id, {
          name: v.name.trim(),
          description: v.description.trim(),
          permissions: v.permissions,
        });
        feedback.notify({ title: "Perfil de acesso atualizado com sucesso!", type: "success" });
      } else {
        await api.iam.createRole({
          id: cleanSlug,
          name: v.name.trim(),
          description: v.description.trim(),
          permissions: v.permissions,
        });
        feedback.notify({ title: "Perfil de acesso criado com sucesso!", type: "success" });
      }
      resolve(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao salvar perfil";
      feedback.notify({ title: msg, type: "error" });
      setSaving(false);
    }
  };

  return (
    <>
      <Form {...form}>
        <form
          id="role-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          <FieldGroup>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="w-full">
                  <FormLabel className="w-fit leading-snug">Nome do Grupo</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Auditor Financeiro" required {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem className="w-full">
                  <FormLabel className="w-fit leading-snug">Identificador do Grupo (slug)</FormLabel>
                  <FormControl>
                    <Input placeholder="auditor_financeiro" disabled={isEditMode} required {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="w-full">
                  <FormLabel className="w-fit leading-snug">Descrição</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descreva a finalidade e escopo de acesso deste grupo..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FieldGroup>

          {/* Matriz de Permissões: Módulos de Sistema (system:*) */}
          <FormField
            control={form.control}
            name="permissions"
            render={({ field }) => (
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
                                checked={field.value.includes("*") || field.value.includes(p.key)}
                                onCheckedChange={(checked: boolean) =>
                                  field.onChange(
                                    checked
                                      ? [...field.value.filter((k) => k !== p.key && k !== "*"), p.key]
                                      : field.value.filter((k) => k !== p.key && k !== "*"),
                                  )
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </CardContent>
              </Card>
            )}
          />

          <p className="text-xs text-muted-foreground">
            Permissões de Dashboards são configuradas diretamente na página de cada Dashboard.
          </p>
        </form>
      </Form>

      <WindowActions>
        <WindowCancelButton />
        <Button form="role-form" type="submit" disabled={saving}>
          {saving ? "Salvando..." : isEditMode ? "Salvar Alterações" : "Criar Grupo"}
        </Button>
      </WindowActions>
    </>
  );
};

export const IAMRolesPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const ui = useUi();
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [loading, setLoading] = useState(true);

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
      ui.feedback.notify({ title: msg, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openSheet = async (role: Role | null) => {
    const result = await ui.windows.open<true>({
      surface: "sheet",
      title: role ? `Editar Grupo: ${role.name}` : "Novo Grupo de Acesso",
      description: "Configure os dados básicos do grupo e selecione as permissões atribuídas.",
      content: () => <RoleSheetContent role={role} catalog={catalog} />,
    });
    if (result.status === "confirmed") fetchData();
  };
  const openCreateSheet = () => openSheet(null);
  const openEditSheet = (r: Role) => openSheet(r);

  const columns: DataTableColumn<Role>[] = [
    {
      key: "id",
      label: "Identificador (Slug)",
      value: (r) => r.id,
      cellClassName: "font-mono text-xs font-semibold",
      skeletonClassName: "h-4 w-24",
      mobileRole: "secondary",
    },
    {
      key: "name",
      label: "Nome do Grupo",
      value: (r) => r.name,
      cellClassName: "font-medium",
      skeletonClassName: "h-4 w-32",
      mobileRole: "primary",
    },
    {
      key: "description",
      label: "Descrição",
      value: (r) => r.description || "-",
      cellClassName: "text-xs text-muted-foreground",
      skeletonClassName: "h-4 w-56",
    },
    {
      key: "permissions",
      label: "Permissões Ativas",
      value: (r) => (r.permissions.includes("*") ? "Acesso Total (*)" : `${r.permissions.length} permissões`),
      render: (r) => (
        <Badge variant="secondary">
          {r.permissions.includes("*") ? "Acesso Total (*)" : `${r.permissions.length} permissões`}
        </Badge>
      ),
      skeletonClassName: "h-5 w-20",
    },
  ];

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
        <h1 className="text-2xl font-bold tracking-tight">Grupos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie permissões granulares no modelo Permission-First.
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={roles}
        getRowId={(r) => r.id}
        loading={loading}
        skeletonRows={3}
        title={`Grupos Registrados (${roles.length})`}
        emptyMessage="Nenhum grupo de acesso cadastrado."
        rowActions={(r) =>
          hasPermission("system:roles:update") ? (
            <Button variant="ghost" size="icon" aria-label="Editar" title="Editar" onClick={() => openEditSheet(r)}>
              <Edit2 className="size-4" />
            </Button>
          ) : null
        }
      />
    </div>
  );
};
