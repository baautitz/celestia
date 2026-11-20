import React from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@platform/ui/components/card";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { PasswordInput } from "@platform/ui/components/password-input";
import { Button } from "@platform/ui/components/button";
import { CenteredScreen, Stack } from "@platform/ui/components/layout";
import { safeCertificateUrl } from "@/lib/certificate-url";
import { useUi } from "@platform/ui/imperative/provider";

const loginSchema = z.object({
  username: z.string().min(1, "Informe o nome de usuário"),
  password: z.string().min(1, "Informe a senha"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export const LoginPage: React.FC = () => {
  const { login, isAuthenticated } = useAuth();
  const ui = useUi();
  const navigate = useNavigate();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const onSubmit = async (values: LoginFormValues) => {
    try {
      const { certificateUrl } = await login(values.username, values.password);
      if (certificateUrl) {
        // Quem exige certificado segue para a autoridade certificadora, onde o navegador o apresenta; o login termina no callback.
        const target = safeCertificateUrl(certificateUrl);
        if (!target) {
          ui.feedback.notify({ type: "error", title: "Endereço de verificação do certificado inválido." });
          return;
        }
        window.location.assign(target);
        return;
      }
      ui.feedback.notify({ type: "success", title: "Login efetuado com sucesso!" });
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha na autenticação.";
      ui.feedback.notify({ type: "error", title: msg });
    }
  };

  return (
    <CenteredScreen>
      <Card>
        <CardHeader centered>
          <CardTitle>Celestia</CardTitle>
          <CardDescription>Entre com seu usuário e senha para continuar.</CardDescription>
        </CardHeader>

        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <FieldGroup>
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Usuário</FormLabel>
                      <FormControl>
                        <Input {...field} autoFocus autoComplete="username" />
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
                      <FormLabel>Senha</FormLabel>
                      <FormControl>
                        <PasswordInput {...field} autoComplete="current-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Stack>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? "Autenticando..." : "Entrar"}
                  </Button>
                </Stack>
              </FieldGroup>
            </form>
          </Form>
        </CardContent>

      </Card>
    </CenteredScreen>
  );
};
