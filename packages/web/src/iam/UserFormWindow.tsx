import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { User, Role, JWTAccessPayload } from "@platform/shared";
import { Button } from "@platform/ui/components/button";
import { Grid, Text } from "@platform/ui/components/layout";
import { Input } from "@platform/ui/components/input";
import { PasswordInput } from "@platform/ui/components/password-input";
import { FieldGroup, Field, FieldContent, FieldLabel, FieldDescription } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Switch } from "@platform/ui/components/switch";
import { useUi } from "@platform/ui/imperative/provider";
import { useWindow, WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import type { WindowService } from "@platform/ui/contracts/windows";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api-client";

const userSchema = z.object({
  fullname: z.string().min(1, "Informe o nome completo."),
  username: z.string().min(1, "Informe o nome de usuário."),
  // Opcional: em branco, o Usuário fica sem e-mail.
  email: z.string().trim().pipe(z.literal("").or(z.string().email("E-mail inválido."))),
  roleId: z.string().min(1, "Selecione o perfil de acesso."),
  isAdmin: z.boolean(),
  allowWithoutCertificate: z.boolean(),
  password: z.string(),
});
type UserFormValues = z.infer<typeof userSchema>;

interface UserFormWindowProps {
  user: User | null;
  roles: Role[];
  currentUser: JWTAccessPayload | null;
  /** Nome Completo inicial no cadastro (p.ex. o de um Colaborador). */
  fullname?: string;
  /** No cadastro, o username acompanha o Nome Completo até ser digitado à mão. */
  suggestUsername?: (fullname: string) => string;
}

/** Janela de cadastro e edição de Usuário; resolve com o Usuário salvo. */
export const UserFormWindow: React.FC<UserFormWindowProps> = ({ user, roles, currentUser, fullname, suggestUsername }) => {
  const { resolve } = useWindow<User>();
  const ui = useUi();
  const isEditMode = user !== null;
  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      fullname: user?.fullname ?? fullname ?? "",
      username: user?.username ?? (fullname && suggestUsername ? suggestUsername(fullname) : ""),
      email: user?.email ?? "",
      // No cadastro nada vem escolhido: o perfil é sempre uma escolha consciente.
      roleId: user?.roleId ?? "",
      isAdmin: user?.isAdmin === true,
      allowWithoutCertificate: user?.allowWithoutCertificate === true,
      password: "",
    },
  });
  const roleId = form.watch("roleId");

  const nomeCompleto = form.watch("fullname");
  const { dirtyFields } = form.formState;
  useEffect(() => {
    if (!isEditMode && suggestUsername && !dirtyFields.username) form.setValue("username", suggestUsername(nomeCompleto));
  }, [isEditMode, suggestUsername, nomeCompleto, dirtyFields.username, form]);
  const getRoleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  const onSubmit = async (v: UserFormValues) => {
    try {
      if (user) {
        const saved = await api.iam.updateUser(user.id, {
          fullname: v.fullname.trim(),
          email: v.email.trim() || undefined,
          roleId: v.roleId,
          ...(currentUser?.isAdmin ? { isAdmin: v.isAdmin, allowWithoutCertificate: v.allowWithoutCertificate } : {}),
        });
        ui.feedback.notify({ type: "success", title: "Usuário atualizado com sucesso!" });
        resolve(saved);
      } else {
        const saved = await api.iam.createUser({
          fullname: v.fullname.trim(),
          username: v.username.trim(),
          email: v.email.trim() || undefined,
          password: v.password,
          roleId: v.roleId,
          ...(currentUser?.isAdmin && v.allowWithoutCertificate ? { allowWithoutCertificate: true } : {}),
        });
        ui.feedback.notify({ type: "success", title: "Usuário cadastrado com sucesso!" });
        resolve(saved);
      }
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
                      <PasswordInput autoComplete="new-password" placeholder="Mínimo 8 caracteres (Aa1@)" {...field} />
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

/** Cadastro carregando os Grupos e o Usuário logado: é o que outros módulos abrem pelo serviço `iam:users`. */
const CreateUserWindow: React.FC<Pick<UserFormWindowProps, "fullname" | "suggestUsername">> = (props) => {
  const { user: currentUser } = useAuth();
  const ui = useUi();
  const [roles, setRoles] = useState<Role[] | null>(null);
  useEffect(() => {
    api.iam
      .listRoles()
      .then(setRoles)
      .catch((err: unknown) => ui.feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar os Grupos.")));
  }, [ui.feedback]);
  if (!roles) return <Text tone="muted">Carregando os Grupos...</Text>;
  return <UserFormWindow user={null} roles={roles} currentUser={currentUser} {...props} />;
};

/** Título e descrição da janela, iguais em toda tela que cadastra ou edita Usuário. */
export const userFormWindowTexts = (user: User | null) => ({
  title: user ? "Editar Usuário" : "Cadastrar Novo Usuário",
  description: user ? "Atualize os dados e o perfil do usuário." : "Crie uma nova identidade no sistema com perfil e senha inicial.",
});

/** Serviço `iam:users` do módulo web: outros módulos abrem o mesmo cadastro de Usuário. */
export const usersWebService = {
  /** Abre o cadastro de Usuário; resolve com o Usuário criado, ou `null` se a janela for fechada. */
  async openCreate(windows: WindowService<React.ComponentType>, options: { fullname?: string; suggestUsername?: (fullname: string) => string } = {}): Promise<User | null> {
    const result = await windows.open<User>({
      surface: "dialog",
      size: "small",
      ...userFormWindowTexts(null),
      content: () => <CreateUserWindow {...options} />,
    });
    return result.status === "confirmed" ? result.value : null;
  },
};
