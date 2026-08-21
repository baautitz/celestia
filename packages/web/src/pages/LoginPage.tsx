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
  CardFooter,
} from "@/components/ui/card";
import { FieldGroup, Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "@/components/ui/toast";
import { ShieldCheck, Crown, Wrench, UserCheck } from "lucide-react";

const loginSchema = z.object({
  username: z.string().min(1, "Informe o nome de usuário"),
  password: z.string().min(1, "Informe a senha"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export const LoginPage: React.FC = () => {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "carlos.admin",
      password: "Senha@123",
    },
  });

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate("/workspaces", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const onSubmit = async (values: LoginFormValues) => {
    try {
      await login(values.username, values.password);
      toast.success("Login efetuado com sucesso!");
      navigate("/workspaces", { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha na autenticação.";
      toast.error(msg);
    }
  };

  const handleSelectDemoProfile = (values: string[]) => {
    const value = values[0];
    if (!value) return;
    if (value === "admin") {
      setValue("username", "carlos.admin");
      setValue("password", "Senha@123");
    } else if (value === "operador") {
      setValue("username", "maria.souza");
      setValue("password", "Senha@123");
    } else if (value === "vendedor") {
      setValue("username", "joao.silva");
      setValue("password", "Senha@123");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4 bg-muted/20">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center items-center justify-center pb-4 flex flex-col">
          <Avatar className="size-12 mb-2">
            <AvatarFallback className="bg-primary text-primary-foreground font-bold">
              S
            </AvatarFallback>
          </Avatar>
          <CardTitle className="text-xl font-bold">SDUI Enterprise</CardTitle>
          <CardDescription>
            Plataforma de Fechamentos & Auditoria Operacional
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!errors.username}>
                <FieldLabel htmlFor="username">Usuário</FieldLabel>
                <Input
                  {...register("username")}
                  id="username"
                  placeholder="nome.sobrenome"
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
                  placeholder="••••••••"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                />
                {errors.password?.message && (
                  <FieldError>{errors.password.message}</FieldError>
                )}
              </Field>

              <Button
                type="submit"
                className="w-full mt-2"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Autenticando..." : "Entrar na Plataforma"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>

        <CardFooter className="flex flex-col items-start gap-3 pt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            <span>Acessos Rápidos de Demonstração:</span>
          </div>

          <ToggleGroup
            variant="outline"
            className="w-full justify-start"
            onValueChange={handleSelectDemoProfile}
          >
            <ToggleGroupItem value="admin" className="flex-1">
              <Crown className="size-3.5 mr-1 text-amber-500" />
              Admin
            </ToggleGroupItem>
            <ToggleGroupItem value="operador" className="flex-1">
              <Wrench className="size-3.5 mr-1 text-blue-500" />
              Operador
            </ToggleGroupItem>
            <ToggleGroupItem value="vendedor" className="flex-1">
              <UserCheck className="size-3.5 mr-1 text-emerald-500" />
              Vendedor
            </ToggleGroupItem>
          </ToggleGroup>
        </CardFooter>
      </Card>
    </main>
  );
};
