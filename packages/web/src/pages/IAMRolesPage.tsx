import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import type { Role, PermissionCatalog, PermissionItem } from "@platform/shared";
import { Card, CardHeader, CardTitle, CardContent } from "@platform/ui/components/card";
import { Button } from "@platform/ui/components/button";
import { PageHeader, Show, Spin, Stack, Text } from "@platform/ui/components/layout";
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
  name: z.string().min(1, "Informe o nome do grupo."),
  slug: z.string().min(1, "Informe o identificador do grupo."),
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
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
        >
<Stack gap={6}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do Grupo</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Auditor Financeiro" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Identificador do Grupo (slug)</FormLabel>
                  <FormControl>
                    <Input placeholder="auditor_financeiro" disabled={isEditMode} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
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
                <CardHeader>
                  <CardTitle>
                    <Stack direction="row" align="center" gap={2}>
                      <Shield />
                      <Text variant="eyebrow" tone="muted">
                        Módulos de Sistema
                      </Text>
                    </Stack>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Stack gap={3}>
                  {catalog &&
                    Object.entries(catalog.system).map(([moduleName, perms]) => (
                      <Stack key={moduleName} gap={2}>
                        <Stack surface="muted">
                          <Text variant="eyebrow">Módulo: {moduleName}</Text>
                        </Stack>
                        <Stack divided>
                          {perms.map((p: PermissionItem) => (
                            <Stack key={p.key} direction="row" align="center" justify="between" gap={4} padding={2}>
                              <Stack grow>
                                <Text variant="mono" weight="medium" breakAll>
                                  {p.key}
                                </Text>
                                {p.description && (
                                  <Text variant="tiny" tone="muted">
                                    {p.description}
                                  </Text>
                                )}
                              </Stack>
                              <Switch
                                checked={field.value.includes("*") || field.value.includes(p.key)}
                                onCheckedChange={(checked: boolean) =>
                                  field.onChange(
                                    checked
                                      ? [...field.value.filter((k) => k !== p.key && k !== "*"), p.key]
                                      : field.value.filter((k) => k !== p.key && k !== "*"),
                                  )
                                }
                              />
                            </Stack>
                          ))}
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            )}
          />
</Stack>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial única
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
      mobileLabel: "Permissões",
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
    <Stack gap={6}>
      <HeaderActions>
        <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
          <Spin active={loading}><RefreshCw /></Spin>
        </Button>

        {hasPermission("system:roles:create") && (
          <Show on="desktop">
            <Button onClick={openCreateSheet}>
            <PlusCircle />
            Novo Grupo
            </Button>
          </Show>
        )}

        {hasPermission("system:roles:create") && (
          <Show on="mobile">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openCreateSheet}>
                <PlusCircle />
                Novo Grupo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </Show>
        )}
      </HeaderActions>

      {/* Top Header */}
      <PageHeader title="Grupos" description="Gerencie permissões granulares no modelo Permission-First." />

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
              <Edit2 />
            </Button>
          ) : null
        }
      />
    </Stack>
  );
};
