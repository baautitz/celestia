import type React from "react";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@platform/ui/components/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { PasswordInput } from "@platform/ui/components/password-input";
import { Stack, Text } from "@platform/ui/components/layout";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, useWindow } from "@platform/ui/imperative/use-window";
import { useAuth } from "@/context/AuthContext";

const unlockSchema = z.object({ password: z.string().min(1, "Informe a senha") });
type UnlockValues = z.infer<typeof unlockSchema>;

const UnlockForm: React.FC = () => {
  const { locked, lockedUser, unlock, logout } = useAuth();
  const { resolve } = useWindow<true>();
  const form = useForm<UnlockValues>({ resolver: zodResolver(unlockSchema), defaultValues: { password: "" } });

  // Desbloqueada em outra aba (ou sessão encerrada): a janela some sozinha.
  useEffect(() => {
    if (!locked) resolve(true);
  }, [locked, resolve]);

  const onSubmit = async ({ password }: UnlockValues) => {
    try {
      await unlock(password);
    } catch (err: unknown) {
      form.setError("password", { message: err instanceof Error ? err.message : "Não foi possível desbloquear." });
      form.resetField("password", { keepError: true });
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="unlock-form" onSubmit={form.handleSubmit(onSubmit)}>
          <Stack gap="group">
            {lockedUser && (
              <Stack gap="tight">
                <Text weight="medium">{lockedUser.fullname}</Text>
                <Text tone="muted">{lockedUser.username}</Text>
              </Stack>
            )}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha</FormLabel>
                  <FormControl>
                    <PasswordInput autoFocus autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Stack>
        </form>
      </Form>
      <WindowActions>
        <Button type="button" variant="outline" onClick={() => void logout()}>
          Sair
        </Button>
        <Button form="unlock-form" type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Verificando..." : "Desbloquear"}
        </Button>
      </WindowActions>
    </>
  );
};

/**
 * Janela de senha por cima da tela quando a sessão fica ociosa. A página não recarrega: formulários, janelas e filtros
 * abertos ficam como estavam, e as requisições pendentes são refeitas depois do desbloqueio. Não tem X e Esc ou clique
 * fora não a fecham (`dismissible: false`): só a senha, "Sair" ou o desbloqueio em outra aba a resolvem.
 */
export const SessionLockGate: React.FC = () => {
  const { locked } = useAuth();
  const ui = useUi();
  const open = useRef(false);

  useEffect(() => {
    if (!locked || open.current) return;
    open.current = true;
    void ui.windows
      .open<true>({
        surface: "dialog",
        size: "small",
        dismissible: false,
        title: "Sessão bloqueada",
        description: "Você ficou um tempo sem usar o sistema. Confirme a senha para continuar de onde parou.",
        content: () => <UnlockForm />,
      })
      // Sem laço de reabertura: uma janela desmontada pelo host resolveria na hora e o laço travaria a página.
      .finally(() => {
        open.current = false;
      });
  }, [locked, ui]);

  return null;
};
