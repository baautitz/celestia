import React, { useEffect, useState } from "react";
import { useLatest } from "@platform/ui/hooks/use-latest";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import type { User, Role, JWTAccessPayload } from "@platform/shared";
import { Button } from "@platform/ui/components/button";
import { Grid, PageHeader, Show, Spin, Stack, Text } from "@platform/ui/components/layout";
import { Input } from "@platform/ui/components/input";
import { Badge } from "@platform/ui/components/badge";
import { FieldGroup, Field, FieldContent, FieldLabel, FieldDescription } from "@platform/ui/components/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@platform/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@platform/ui/components/select";
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
  CheckCircle2,
  Clock,
} from "lucide-react";
import { Switch } from "@platform/ui/components/switch";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";

const userSchema = z.object({
  fullname: z.string().min(1, "Informe o nome completo."),
  username: z.string().min(1, "Informe o nome de usuário."),
  // Opcional: em branco, o Usuário fica sem e-mail.
  email: z.string().trim().pipe(z.literal("").or(z.string().email("E-mail inválido."))),
  roleId: z.string().min(1),
  isAdmin: z.boolean(),
  allowWithoutCertificate: z.boolean(),
  password: z.string(),
});
type UserFormValues = z.infer<typeof userSchema>;

const resetSchema = z.object({
  newPassword: z.string().min(1, "Informe a nova senha."),
});
type ResetFormValues = z.infer<typeof resetSchema>;

interface UserFormWindowProps {
  user: User | null;
  roles: Role[];
  currentUser: JWTAccessPayload | null;
}

const UserFormWindow: React.FC<UserFormWindowProps> = ({ user, roles, currentUser }) => {
  const { resolve } = useWindow<boolean>();
  const ui = useUi();
  const isEditMode = user !== null;
  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      fullname: user?.fullname ?? "",
      username: user?.username ?? "",
      email: user?.email ?? "",
      roleId: user?.roleId ?? (roles[0]?.id || "role_operador"),
      isAdmin: user?.isAdmin === true,
      allowWithoutCertificate: user?.allowWithoutCertificate === true,
      password: "",
    },
  });
  const roleId = form.watch("roleId");
  const getRoleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  const onSubmit = async (v: UserFormValues) => {
    try {
      if (user) {
        await api.iam.updateUser(user.id, {
          fullname: v.fullname.trim(),
          email: v.email.trim() || undefined,
          roleId: v.roleId,
          ...(currentUser?.isAdmin ? { isAdmin: v.isAdmin, allowWithoutCertificate: v.allowWithoutCertificate } : {}),
        });
        ui.feedback.notify({ type: "success", title: "Usuário atualizado com sucesso!" });
      } else {
        await api.iam.createUser({
          fullname: v.fullname.trim(),
          username: v.username.trim(),
          email: v.email.trim() || undefined,
          password: v.password,
          roleId: v.roleId,
          ...(currentUser?.isAdmin && v.allowWithoutCertificate ? { allowWithoutCertificate: true } : {}),
        });
        ui.feedback.notify({ type: "success", title: "Usuário cadastrado com sucesso!" });
      }
      resolve(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao salvar usuário";
      ui.feedback.notify({ type: "error", title: msg });
    }
  };

  const submitting = form.formState.isSubmitting;

  return (
    <>
      <Form {...form}>
        <form id="user-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="fullname"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome Completo</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Carlos Silva" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Grid columns={2}>
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome de Usuário</FormLabel>
                    <FormControl>
                      <Input placeholder="carlos.silva" disabled={isEditMode} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="carlos@empresa.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Grid>

            <FormField
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Perfil de Acesso</FormLabel>
                  <Select value={field.value} onValueChange={(val: string | null) => val && field.onChange(val)}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o perfil">
                          {roleId ? getRoleName(roleId) : undefined}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isEditMode && currentUser?.isAdmin && (
              <FormField
                control={form.control}
                name="isAdmin"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor="u-admin">Administrador</FieldLabel>
                      <FieldDescription>Ignora a matriz de permissões e tem acesso total.</FieldDescription>
                    </FieldContent>
                    <Switch
                      id="u-admin"
                      checked={field.value}
                      disabled={user?.id === currentUser.sub}
                      onCheckedChange={(checked: boolean) => field.onChange(checked)}
                    />
                  </Field>
                )}
              />
            )}

            {currentUser?.isAdmin && (
              <FormField
                control={form.control}
                name="allowWithoutCertificate"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor="u-no-cert">Permitir acesso sem certificado</FieldLabel>
                      <FieldDescription>Entra só com a senha, sem o certificado de um Dispositivo homologado.</FieldDescription>
                    </FieldContent>
                    <Switch id="u-no-cert" checked={field.value} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
                  </Field>
                )}
              />
            )}

            {!isEditMode && (
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha Inicial</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Mínimo 8 caracteres (Aa1@)" {...field} />
                    </FormControl>
                    <Text variant="tiny" tone="muted">
                      Requer: 1 maiúscula, 1 minúscula, 1 número e 1 especial.
                    </Text>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </FieldGroup>
        </form>
      </Form>
      <WindowActions>
        <WindowCancelButton />
        <Button type="submit" form="user-form" disabled={submitting}>
          {submitting ? "Salvando..." : isEditMode ? "Salvar Alterações" : "Cadastrar Usuário"}
        </Button>
      </WindowActions>
    </>
  );
};

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
                    <Input type="password" placeholder="Mínimo 8 caracteres (Aa1@)" {...field} />
                  </FormControl>
                  <Text variant="tiny" tone="muted">
                    Requer 1 maiúscula, 1 minúscula, 1 número e 1 especial.
                  </Text>
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
    const result = await ui.windows.open<boolean>({
      surface: "dialog",
      size: "small",
      title: u ? "Editar Usuário" : "Cadastrar Novo Usuário",
      description: u
        ? "Atualize os dados e o perfil do usuário."
        : "Crie uma nova identidade no sistema com perfil e senha inicial.",
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
          </Stack>
        )}
      />
    </Stack>
  );
};
