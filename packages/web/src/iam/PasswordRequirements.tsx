import React, { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Stack, Text } from "@platform/ui/components/layout";
import { api } from "@/lib/api-client";

interface Regra {
  label: string;
  pattern: RegExp;
}

// A política é do IAM no servidor: lida uma vez por sessão da página.
let politica: Promise<Regra[]> | null = null;
const carregarPolitica = () =>
  (politica ??= api.iam
    .getPasswordPolicy()
    .then(({ rules }) => rules.map((r) => ({ label: r.label, pattern: new RegExp(r.pattern) })))
    .catch((err: unknown) => {
      politica = null;
      throw err;
    }));

/** O que a senha já cumpre (verde) e o que ainda falta (vermelho) na política de senha do IAM. */
export const PasswordRequirements: React.FC<{ value: string }> = ({ value }) => {
  const [regras, setRegras] = useState<Regra[]>([]);
  useEffect(() => {
    let ativo = true;
    carregarPolitica()
      .then((r) => ativo && setRegras(r))
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <Stack role="list" aria-label="Requisitos da senha" direction="row" gap="group" wrap>
      {regras.map((regra) => {
        const ok = regra.pattern.test(value);
        const tone = ok ? "success" : "destructive";
        return (
          <Stack key={regra.label} role="listitem" data-ok={ok} direction="row" gap="tight" align="center">
            <Text variant="tiny" tone={tone}>
              {ok ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}
            </Text>
            <Text variant="tiny" tone={tone}>
              {regra.label}
            </Text>
          </Stack>
        );
      })}
    </Stack>
  );
};
