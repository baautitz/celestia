import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Card, CardHeader, CardTitle, CardDescription } from "@platform/ui/components/card";
import { CenteredScreen } from "@platform/ui/components/layout";
import { useUi } from "@platform/ui/imperative/provider";

/**
 * Callback do login por certificado: a autoridade certificadora devolve o navegador aqui com o desafio e, se achou
 * um Dispositivo ativo, o código de uso único. O backend troca os dois com a autoridade e abre a sessão. Se a troca
 * falha, volta à tela de login com o motivo num aviso de erro.
 */
export const LoginCertificatePage: React.FC = () => {
  const { loginWithCertificate } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ui = useUi();
  // O desafio vale uma única tentativa: a troca não pode rodar duas vezes (nem no StrictMode do desenvolvimento).
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    const backToLogin = (message: string) => {
      ui.feedback.notify({ type: "error", title: message });
      navigate("/login", { replace: true });
    };
    const challengeId = params.get("challenge");
    if (!challengeId) {
      backToLogin("Falha na autenticação. Entre novamente.");
      return;
    }
    loginWithCertificate(challengeId, params.get("code") ?? undefined).then(
      () => navigate("/", { replace: true }),
      (err: unknown) => backToLogin(err instanceof Error ? err.message : "Falha na autenticação."),
    );
  }, [loginWithCertificate, navigate, params, ui]);

  return (
    <CenteredScreen>
      <Card>
        <CardHeader centered>
          <CardTitle>Celestia</CardTitle>
          <CardDescription>Verificando o Dispositivo...</CardDescription>
        </CardHeader>
      </Card>
    </CenteredScreen>
  );
};
