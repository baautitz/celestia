import React, { useEffect, useState } from "react";
import { useLatest } from "@platform/ui/hooks/use-latest";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import type { User, Role } from "@platform/shared";
import { Button } from "@platform/ui/components/button";
import { PageHeader, Show, Spin, Stack, Text } from "@platform/ui/components/layout";
import { Badge } from "@platform/ui/components/badge";
import { FieldGroup } from "@platform/ui/components/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@platform/ui/components/form";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@platform/ui/components/dropdown-menu";
import { DataTable } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { useWindow, WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import {
  UserPlus,
  KeyRound,
  RefreshCw,
  MoreHorizontal,
  Edit2,
  Power,
  Trash2,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";
import { UserFormWindow, userFormWindowTexts } from "@/iam/UserFormWindow";
import { PasswordInput } from "@platform/ui/components/password-input";
import { PasswordRequirements } from "@/iam/PasswordRequirements";


const resetSchema = z.object({
  newPassword: z.string().min(1, "Informe a nova senha."),
});
type ResetFormValues = z.infer<typeof resetSchema>;


const ResetPasswordWindow: React.FC<{ user: User }> = ({ user }) => {
  const { resolve } = useWindow<boolean>();
  const ui = useUi();
  const form = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: "" },
  });

  const onSubmit = async (v: ResetFormValues) => {
    try {
      await api.iam.resetPassword(user.id, v.newPassword);
      ui.feedback.notify({ type: "success", title: `Senha de ${user.username} redefinida com sucesso!` });
      resolve(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao redefinir senha";
      ui.feedback.notify({ type: "error", title: msg });
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="reset-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nova Senha</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" placeholder="Mínimo 8 caracteres (Aa1@)" {...field} />
                  </FormControl>
                    <PasswordRequirements value={field.value} />
                  <FormMessage />
                </FormItem>
              )}
            />
          </FieldGroup>
        </form>
      </Form>
      <WindowActions>
        <WindowCancelButton />
        <Button type="submit" form="reset-form" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Salvando..." : "Salvar Senha"}
        </Button>
      </WindowActions>
    </>
  );
};

export const IAMUsersPage: React.FC = () => {
  const { user: currentUser, hasPermission } = useAuth();
  const ui = useUi();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [usersRes, rolesRes] = await Promise.all([api.iam.listUsers(), api.iam.listRoles()]);
      setUsers(usersRes);
      setRoles(rolesRes);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao carregar usuários";
      ui.feedback.notify({ type: "error", title: msg });
    } finally {
      setLoading(false);
    }
  };

  const fetchDataRef = useLatest(fetchData);
  useEffect(() => {
    fetchDataRef.current();
  }, [fetchDataRef]);

  const openUserWindow = async (u: User | null) => {
    const result = await ui.windows.open<User>({
      surface: "dialog",
      size: "small",
      ...userFormWindowTexts(u),
      content: () => <UserFormWindow user={u} roles={roles} currentUser={currentUser} />,
    });
    if (result.status === "confirmed") fetchData();
  };

  const openResetWindow = (u: User) => {
    void ui.windows.open<boolean>({
      surface: "dialog",
      size: "small",
      title: "Redefinir Senha",
      description: (
        <>
          Defina uma nova senha para <Text as="strong" weight="semibold">{u.fullname}</Text> ({u.username}).
        </>
      ),
      content: () => <ResetPasswordWindow user={u} />,
    });
  };

  const handleToggleStatus = async (user: User) => {
    try {
      const nextStatus = user.status === "active" ? "inactive" : "active";
      await api.iam.updateUser(user.id, { status: nextStatus });
      ui.feedback.notify({
        type: "success",
        title: `Usuário ${user.username} ${nextStatus === "active" ? "ativado" : "desativado"}.`,
      });
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao alterar status";
      ui.feedback.notify({ type: "error", title: msg });
      fetchData();
    }
  };

  const handleDelete = async (user: User) => {
    const ok = await ui.windows.confirm({
      title: "Excluir Usuário",
      description: `Excluir ${user.fullname} (${user.username})? A exclusão não pode ser desfeita; para só impedir o acesso, desative o Usuário.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.iam.deleteUser(user.id);
      ui.feedback.notify({ type: "success", title: `Usuário ${user.username} excluído.` });
    } catch (err: unknown) {
      ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : "Erro ao excluir usuário" });
    }
    fetchData();
  };

  const getRoleName = (roleId: string) => {
    const r = roles.find((role) => role.id === roleId);
    return r ? r.name : roleId;
  };

  return (
    <Stack gap="section">
      <HeaderActions>
        <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
          <Spin active={loading}><RefreshCw /></Spin>
        </Button>

        {hasPermission("system:users:create") && (
          <Show on="lgUp">
            <Button onClick={() => openUserWindow(null)}>
            <UserPlus />
            Novo Usuário
            </Button>
          </Show>
        )}

        {hasPermission("system:users:create") && (
          <Show on="belowLg">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openUserWindow(null)}>
                <UserPlus />
                Novo Usuário
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </Show>
        )}
      </HeaderActions>

      {/* Top Header */}
      <PageHeader title="Gestão de Usuários" description="Controle de acessos, grupos e identidades de autenticação." />

      <DataTable<User>
        rows={users}
        getRowId={(u) => u.id}
        loading={loading}
        title={(count) => `Usuários Cadastrados (${count})`}
        emptyMessage="Nenhum usuário encontrado."
        search={{ placeholder: "Buscar por nome, usuário ou e-mail..." }}
        columns={[
          {
            key: "fullname",
            label: "Nome Completo",
            value: (u) => u.fullname,
            searchable: true,
            cellClassName: "font-medium",
            skeletonClassName: "h-4 w-40",
            mobileRole: "primary",
          },
          {
            key: "username",
            label: "Usuário",
            value: (u) => u.username,
            searchable: true,
            cellClassName: "font-mono text-xs text-muted-foreground",
            skeletonClassName: "h-4 w-24",
            mobileRole: "secondary",
          },
          {
            key: "email",
            label: "E-mail",
            value: (u) => u.email || "-",
            searchable: true,
            cellClassName: "text-xs text-muted-foreground",
            skeletonClassName: "h-4 w-36",
          },
          {
            key: "role",
            label: "Perfil",
            value: (u) => getRoleName(u.roleId),
            render: (u) => <Badge variant="secondary">{getRoleName(u.roleId)}</Badge>,
            skeletonClassName: "h-5 w-24",
          },
          {
            key: "access",
            label: "Acesso",
            value: (u) => (u.allowWithoutCertificate ? "Sem certificado" : "Com certificado"),
            render: (u) => (
              <Badge variant={u.allowWithoutCertificate ? "default" : "secondary"}>
                {u.allowWithoutCertificate ? "Sem certificado" : "Com certificado"}
              </Badge>
            ),
            skeletonClassName: "h-5 w-28",
          },
          {
            key: "status",
            label: "Status",
            value: (u) => u.status,
            render: (u) =>
              u.status === "active" ? (
                <Badge variant="secondary">
                  <CheckCircle2 />
                  Ativo
                </Badge>
              ) : (
                <Badge variant="default">
                  <Clock />
                  Inativo
                </Badge>
              ),
            skeletonClassName: "h-5 w-16",
          },
        ]}
        rowActions={(u) => (
          <Stack direction="row" justify="end" gap="tight">
            {hasPermission("system:users:update") && (
              <Button variant="ghost" size="icon" aria-label="Editar Usuário" title="Editar Usuário" onClick={() => openUserWindow(u)}>
                <Edit2 />
              </Button>
            )}
            {hasPermission("system:users:reset_password") && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Redefinir Senha"
                title="Redefinir Senha"
                onClick={() => openResetWindow(u)}
              >
                <KeyRound />
              </Button>
            )}
            {hasPermission("system:users:update") && (
              <Button
                variant="ghost"
                tone={u.status === "active" ? "destructive" : "success"}
                size="icon"
                aria-label={u.status === "active" ? "Desativar Usuário" : "Ativar Usuário"}
                title={u.status === "active" ? "Desativar Usuário" : "Ativar Usuário"}
                onClick={() => handleToggleStatus(u)}
              >
                <Power />
              </Button>
            )}
            {hasPermission("system:users:delete") && currentUser?.sub !== u.id && (
              <Button variant="ghost" tone="destructive" size="icon" aria-label="Excluir Usuário" title="Excluir Usuário" onClick={() => void handleDelete(u)}>
                <Trash2 />
              </Button>
            )}
          </Stack>
        )}
      />
    </Stack>
  );
};
