import { useState } from "react";
import { Button } from "@platform/ui/components/button";
import { Input } from "@platform/ui/components/input";
import { Label } from "@platform/ui/components/label";
import { Stack, Text } from "@platform/ui/components/layout";
import { MoneyInput } from "@platform/ui/components/money-input";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { regraDoParticipante } from "./apuracao";
import { porcentagem, reais } from "./indicadores";
import type { ParticipanteMeta } from "./metas-store";
import { descreverPremio, type RegraPremio, type TipoMeta } from "./tipos-meta";

/** O Prêmio em poucas palavras, para a coluna dos Participantes. */
export function resumoPremio(regra: RegraPremio): string {
  switch (regra.tipo) {
    case "fixo":
      return reais(regra.valorCentavos);
    case "proporcional":
      return `${reais(regra.valorCentavos)} a 100%`;
    case "faixas":
      return regra.faixas.map((f) => reais(f.valorCentavos)).join(" / ");
    case "percentual":
      return porcentagem(regra.percentual);
    case "saldo":
      return "Saldo";
  }
}

interface MetaDoPremio {
  id: string;
  version: number;
  tipo: TipoMeta;
}

/**
 * Prêmio de um Participante: edita os valores da regra do Tipo de Meta (o tipo de regra não muda).
 * Resolve com a Meta gravada.
 */
export function PremioParticipanteWindow<M extends MetaDoPremio>({ meta, participante }: { meta: M; participante: ParticipanteMeta }) {
  const { resolve } = useWindow<M>();
  const { feedback } = useUi();
  const proprio = Boolean(participante.premio && participante.premio.tipo === meta.tipo.regra.tipo);
  const [regra, setRegra] = useState<RegraPremio>(() => regraDoParticipante(meta.tipo.regra, participante));
  const [percentual, setPercentual] = useState(regra.tipo === "percentual" ? String(regra.percentual).replace(".", ",") : "");
  const [enviando, setEnviando] = useState(false);

  const gravar = async (premio: RegraPremio | null) => {
    setEnviando(true);
    try {
      resolve(
        await apiFetch<M>(`/api/m/inovafarma/metas/${meta.id}/participantes/${participante.codigoColaborador}/premio`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: meta.version, premio }),
        }),
      );
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao alterar o Prêmio."));
    } finally {
      setEnviando(false);
    }
  };

  const centavos = (reais: number) => Math.round(reais * 100);
  return (
    <>
      <Stack gap="section">
        {(regra.tipo === "fixo" || regra.tipo === "proporcional") && (
          <Stack gap="field">
            <Label>{regra.tipo === "fixo" ? "Prêmio se atingir" : "Prêmio a 100% atingido"}</Label>
            <MoneyInput autoFocus value={regra.valorCentavos / 100} onValueChange={(v) => setRegra({ ...regra, valorCentavos: centavos(v) })} aria-label="Valor do Prêmio" />
          </Stack>
        )}
        {regra.tipo === "faixas" &&
          regra.faixas.map((f, i) => (
            <Stack key={i} gap="field">
              <Label>{`Faixa ${i + 1}: a partir de ${porcentagem(f.atingimento)} atingido`}</Label>
              <MoneyInput
                value={f.valorCentavos / 100}
                onValueChange={(v) => setRegra({ ...regra, faixas: regra.faixas.map((x, j) => (j === i ? { ...x, valorCentavos: centavos(v) } : x)) })}
                aria-label={`Prêmio da Faixa ${i + 1}`}
              />
            </Stack>
          ))}
        {regra.tipo === "percentual" && (
          <Stack gap="field">
            <Label>Percentual (%)</Label>
            <Input
              autoFocus
              inputMode="decimal"
              value={percentual}
              aria-label="Percentual (%)"
              onChange={(e) => {
                setPercentual(e.target.value);
                const n = Number(e.target.value.replace(",", "."));
                if (Number.isFinite(n) && n > 0) setRegra({ ...regra, percentual: n });
              }}
            />
          </Stack>
        )}
        <Text variant="small" tone="muted">
          {descreverPremio({ ...meta.tipo, regra })}
        </Text>
      </Stack>
      <WindowActions>
        {proprio && (
          <Button type="button" variant="outline" disabled={enviando} onClick={() => void gravar(null)}>
            Usar o do Tipo de Meta
          </Button>
        )}
        <WindowCancelButton />
        <Button type="button" disabled={enviando} onClick={() => void gravar(regra)}>
          Salvar
        </Button>
      </WindowActions>
    </>
  );
}
