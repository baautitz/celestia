import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Button } from "@platform/ui/components/button";
import { Label } from "@platform/ui/components/label";
import { Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Switch } from "@platform/ui/components/switch";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { formatarValor, indicadorPorId } from "./indicadores";
import { BASE, type TipoMetaComPremio } from "./tipo-meta-window";

interface Participante {
  codigoColaborador: number;
  nome: string;
  alvo: number | null;
}

interface PeriodoComMeta {
  id: string;
  name: string;
  metaId: string;
  version: number;
  participantes: Participante[];
}

/**
 * Janela "Alterar o Alvo padrão": escolhe em quais Períodos abertos e para quais Participantes o novo Alvo padrão vale.
 * Começa com todos marcados; resolve quando aplica.
 */
export function AlvoPadraoWindow({ tipo }: { tipo: TipoMetaComPremio }) {
  const { resolve } = useWindow<true>();
  const { feedback } = useUi();
  const [periodos, setPeriodos] = useState<PeriodoComMeta[] | null>(null);
  const [periodoId, setPeriodoId] = useState("");
  const [marcados, setMarcados] = useState<Record<string, number[]>>({});
  const [enviando, setEnviando] = useState(false);
  const indicador = indicadorPorId(tipo.indicador);
  const avaliacoes = tipo.indicador === "avaliacoes";
  const valor = (n: number | null) => (n === null ? "pendente" : formatarValor(indicador, n));

  useEffect(() => {
    apiFetch<{ periodos: PeriodoComMeta[] }>(`${BASE}/${tipo.id}/aplicacao`)
      .then(({ periodos: lista }) => {
        setPeriodos(lista);
        setPeriodoId(lista[0]?.id ?? "");
        setMarcados(Object.fromEntries(lista.map((p) => [p.id, p.participantes.map((x) => x.codigoColaborador)])));
      })
      .catch((err: unknown) => {
        setPeriodos([]);
        feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as Metas dos Períodos abertos."));
      });
  }, [tipo.id, feedback]);

  if (!periodos) return null;
  const periodo = periodos.find((p) => p.id === periodoId);
  const doPeriodo = marcados[periodoId] ?? [];
  const marcar = (codigos: number[]) => setMarcados((m) => ({ ...m, [periodoId]: codigos }));

  const aplicar = async () => {
    const aplicacoes = periodos.filter((p) => (marcados[p.id] ?? []).length > 0).map((p) => ({ metaId: p.metaId, version: p.version, codigos: marcados[p.id] }));
    if (aplicacoes.length === 0) {
      feedback.notifyError(new Error("Escolha ao menos um Participante."));
      return;
    }
    setEnviando(true);
    try {
      await apiFetch(`${BASE}/${tipo.id}/aplicar-alvo-padrao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aplicacoes }) });
      feedback.notify({ type: "success", title: avaliacoes ? "Valor inicial aplicado." : "Alvo padrão aplicado." });
      resolve(true);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao aplicar o Alvo padrão."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      {periodos.length === 0 || !periodo ? (
        <Alert>
          <AlertTitle>Nenhuma Meta em Período aberto</AlertTitle>
          <AlertDescription>O novo {avaliacoes ? "valor inicial" : "Alvo padrão"} vale para os Participantes que entrarem nas próximas Metas deste Tipo.</AlertDescription>
        </Alert>
      ) : (
        <Stack gap="section">
          <Text variant="small" tone="muted">
            Novo {avaliacoes ? "valor inicial" : "Alvo padrão"}: {valor(tipo.alvoPadrao)}. Escolha a quem aplicar.
          </Text>
          {periodos.length > 1 && (
            <Stack gap="field">
              <Label>Período de Fechamento</Label>
              <Select value={periodoId} onValueChange={(v) => v && setPeriodoId(v)}>
                <SelectTrigger aria-label="Período de Fechamento">
                  <SelectValue>{(id: string) => periodos.find((p) => p.id === id)?.name ?? "Selecione"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {periodos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({(marcados[p.id] ?? []).length} de {p.participantes.length})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Stack>
          )}
          <Stack direction="row" gap="field" wrap>
            <Button type="button" variant="outline" onClick={() => marcar(periodo.participantes.map((p) => p.codigoColaborador))}>
              Selecionar todos
            </Button>
            <Button type="button" variant="outline" onClick={() => marcar([])}>
              Desmarcar todos
            </Button>
          </Stack>
          <Stack gap="field">
            {periodo.participantes.map((p) => (
              <Stack key={p.codigoColaborador} direction="row" gap="field" align="center">
                <Switch
                  checked={doPeriodo.includes(p.codigoColaborador)}
                  onCheckedChange={(on: boolean) => marcar(on ? [...doPeriodo, p.codigoColaborador] : doPeriodo.filter((c) => c !== p.codigoColaborador))}
                  aria-label={p.nome}
                />
                <Text variant="small">
                  {p.nome} · atual: {valor(p.alvo)}
                </Text>
              </Stack>
            ))}
          </Stack>
        </Stack>
      )}
      <WindowActions>
        <WindowCancelButton>{periodos.length === 0 ? "Fechar" : "Não aplicar"}</WindowCancelButton>
        {periodos.length > 0 && (
          <Button type="button" disabled={enviando} onClick={() => void aplicar()}>
            Aplicar
          </Button>
        )}
      </WindowActions>
    </>
  );
}
