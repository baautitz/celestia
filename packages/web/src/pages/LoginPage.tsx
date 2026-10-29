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
import { FieldGroup, Field, FieldLabel, FieldError } from "@platform/ui/components/field";
import { Input } from "@platform/ui/components/input";
import { Button } from "@platform/ui/components/button";
import { CenteredScreen, Stack } from "@platform/ui/components/layout";
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

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
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
      await login(values.username, values.password);
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
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!errors.username}>
                <FieldLabel htmlFor="username">Usuário</FieldLabel>
                <Input
                  {...register("username")}
                  id="username"
                  autoFocus
                  autoComplete="username"
                  aria-invalid={!!errors.username}
                />
                {errors.username?.message && (
                  <FieldError>{errors.username.message}</FieldError>
                )}
              </Field>

              <Field data-invalid={!!errors.password}>
                <FieldLabel htmlFor="password">Senha</FieldLabel>
                <Input
                  {...register("password")}
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                />
                {errors.password?.message && (
                  <FieldError>{errors.password.message}</FieldError>
                )}
              </Field>

              <Stack>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Autenticando..." : "Entrar"}
                </Button>
              </Stack>
            </FieldGroup>
          </form>
        </CardContent>

      </Card>
    </CenteredScreen>
  );
};
