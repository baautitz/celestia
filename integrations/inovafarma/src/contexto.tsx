import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Button } from "@platform/ui/components/button";
import { Stack } from "@platform/ui/components/layout";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { useLatestFetch } from "./use-latest-fetch";

/**
 * Carrega o contexto de uma tela (o que a Permission libera, Períodos, Lojas).
 * `falha` é a mensagem do erro enquanto não há contexto algum; uma recarga que falha com a tela já aberta só avisa por toast.
 */
export function useContexto<T>(url: string, mensagemDeErro: string) {
  const { feedback } = useUi();
  const novaConsulta = useLatestFetch();
  const [contexto, setContexto] = useState<T | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const vale = novaConsulta();
    try {
      const recebido = await apiFetch<T>(url);
      if (!vale()) return;
      setContexto(recebido);
      setFalha(null);
    } catch (err: unknown) {
      if (!vale()) return;
      const erro = err instanceof Error ? err : new Error(mensagemDeErro);
      setFalha(erro.message);
      feedback.notifyError(erro);
    }
  }, [url, mensagemDeErro, feedback, novaConsulta]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return { contexto, falha, carregar };
}

/** No lugar da tela quando o contexto não carregou: diz o que houve e deixa tentar de novo. */
export function FalhaAoCarregar({ titulo, descricao, onTentarNovamente }: { titulo: string; descricao: string; onTentarNovamente: () => void }) {
  return (
    <Stack gap="field">
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>{titulo}</AlertTitle>
        <AlertDescription>{descricao}</AlertDescription>
      </Alert>
      <Stack direction="row">
        <Button variant="outline" onClick={onTentarNovamente}>
          Tentar novamente
        </Button>
      </Stack>
    </Stack>
  );
}
