import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@platform/ui/components/button";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { sugerirUsername } from "./username-sugerido";

export interface GrupoOpcao {
  id: string;
  name: string;
}

interface UsuarioCriado {
  id: string;
  fullname: string;
  username: string;
}

// A política de senha fica no servidor, que devolve a mensagem de cada regra.
const schema = z.object({
  fullname: z.string().trim().min(2, "Informe o nome completo."),
  username: z.string().trim().min(3, "O nome de usuário deve ter ao menos 3 caracteres."),
  password: z.string().min(1, "Informe a senha inicial."),
  roleId: z.string().min(1, "Selecione o Grupo."),
});
type Valores = z.infer<typeof schema>;

/** Janela de criação de Usuário a partir de um Colaborador; resolve com o Usuário criado. */
export function CriarUsuarioWindow({ fullname, grupos }: { fullname: string; grupos: GrupoOpcao[] }) {
  const { resolve } = useWindow<UsuarioCriado>();
  const { feedback } = useUi();
  const form = useForm<Valores>({
    resolver: zodResolver(schema),
    defaultValues: { fullname, username: sugerirUsername(fullname), password: "", roleId: "" },
  });

  // O username acompanha o Nome Completo até ser digitado à mão.
  const nomeCompleto = form.watch("fullname");
  const { dirtyFields } = form.formState;
  useEffect(() => {
    if (!dirtyFields.username) form.setValue("username", sugerirUsername(nomeCompleto));
  }, [nomeCompleto, dirtyFields.username, form]);

  const onSubmit = async (valores: Valores) => {
    try {
      const { id, fullname: nome, username } = await apiFetch<UsuarioCriado>("/api/iam/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valores),
      });
      feedback.notify({ type: "success", title: "Usuário cadastrado com sucesso!" });
      resolve({ id, fullname: nome, username });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao criar o Usuário."));
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="criar-usuario-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="fullname"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome Completo</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome de Usuário</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha Inicial</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Grupo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue>{(id: string) => grupos.find((g) => g.id === id)?.name ?? "Selecione"}</SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {grupos.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FieldGroup>
        </form>
      </Form>
      <WindowActions>
        <WindowCancelButton />
        <Button type="submit" form="criar-usuario-form" disabled={form.formState.isSubmitting}>
          Criar Usuário
        </Button>
      </WindowActions>
    </>
  );
}
