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
import { AlvoInput, rotuloAlvo } from "./alvo-input";
import { formatarValor, indicadorPorId, type IndicadorId } from "./indicadores";
import { BASE, type TipoMetaComPremio } from "./tipo-meta-window";

interface Participante {
  codigoColaborador: number;
  nome: string;
  alvo: number | null;
}

export interface PeriodoComMeta {
  id: string;
  name: string;
  metaId: string;
  version: number;
  participantes: Participante[];
}

interface EscolhaProps {
  indicadorId: IndicadorId;
  periodos: PeriodoComMeta[];
  /** O valor a aplicar; sem ele, a janela mostra o campo do valor (Definir Alvo). */
  valorFixo?: number | null;
  /** Grava; recebe os Participantes marcados por Período e o valor. Lança para manter a janela aberta. */
  aplicar: (marcados: Record<string, number[]>, alvo: number) => Promise<void>;
  vazio: { titulo: string; texto: string };
}

/**
 * Escolha dos Participantes que recebem o mesmo valor (Alvo ou valor inicial), por Período, com Selecionar todos e Desmarcar todos.
 * Começa com todos marcados; resolve quando aplica. Usada no Alterar o Alvo padrão e no Definir Alvo de uma Meta.
 */
function EscolhaDeParticipantes({ indicadorId, periodos, valorFixo, aplicar, vazio }: EscolhaProps) {
  const { resolve } = useWindow<true>();
  const { feedback } = useUi();
  const [periodoId, setPeriodoId] = useState(periodos[0]?.id ?? "");
  const [marcados, setMarcados] = useState<Record<string, number[]>>(() => Object.fromEntries(periodos.map((p) => [p.id, p.participantes.map((x) => x.codigoColaborador)])));
  const [digitado, setDigitado] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const indicador = indicadorPorId(indicadorId);
  const valor = (n: number | null | undefined) => (n == null ? "pendente" : formatarValor(indicador, n));
  const periodo = periodos.find((p) => p.id === periodoId);
  const doPeriodo = marcados[periodoId] ?? [];
  const marcar = (codigos: number[]) => setMarcados((m) => ({ ...m, [periodoId]: codigos }));
  const comCampo = valorFixo === undefined;

  const confirmar = async () => {
    const alvo = comCampo ? digitado : valorFixo;
    if (alvo == null) {
      feedback.notifyError(new Error(`Informe ${indicadorId === "avaliacoes" ? "o valor inicial" : "o Alvo"}.`));
      return;
    }
    if (!Object.values(marcados).some((c) => c.length > 0)) {
      feedback.notifyError(new Error("Escolha ao menos um Participante."));
      return;
    }
    setEnviando(true);
    try {
      await aplicar(marcados, alvo);
      resolve(true);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao aplicar."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      {!periodo ? (
        <Alert>
          <AlertTitle>{vazio.titulo}</AlertTitle>
          <AlertDescription>{vazio.texto}</AlertDescription>
        </Alert>
      ) : (
        <Stack gap="section">
          {comCampo ? (
            <Stack gap="field">
              <Label>{rotuloAlvo(indicador)}</Label>
              <AlvoInput autoFocus indicador={indicador} valor={digitado} onChange={setDigitado} label={rotuloAlvo(indicador)} />
            </Stack>
          ) : (
            <Text variant="small" tone="muted">
              Novo {indicadorId === "avaliacoes" ? "valor inicial" : "Alvo padrão"}: {valor(valorFixo)}. Escolha a quem aplicar.
            </Text>
          )}
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
        <WindowCancelButton>{!periodo ? "Fechar" : "Não aplicar"}</WindowCancelButton>
        {periodo && (
          <Button type="button" disabled={enviando} onClick={() => void confirmar()}>
            Aplicar
          </Button>
        )}
      </WindowActions>
    </>
  );
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Janela "Alterar o Alvo padrão": escolhe em quais Períodos abertos e para quais Participantes o novo Alvo padrão vale. */
export function AlvoPadraoWindow({ tipo }: { tipo: TipoMetaComPremio }) {
  const { feedback } = useUi();
  const [periodos, setPeriodos] = useState<PeriodoComMeta[] | null>(null);
  const avaliacoes = tipo.indicador === "avaliacoes";

  useEffect(() => {
    apiFetch<{ periodos: PeriodoComMeta[] }>(`${BASE}/${tipo.id}/aplicacao`)
      .then(({ periodos: lista }) => setPeriodos(lista))
      .catch((err: unknown) => {
        setPeriodos([]);
        feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as Metas dos Períodos abertos."));
      });
  }, [tipo.id, feedback]);

  if (!periodos) return null;
  return (
    <EscolhaDeParticipantes
      indicadorId={tipo.indicador}
      periodos={periodos}
      valorFixo={tipo.alvoPadrao}
      vazio={{
        titulo: "Nenhuma Meta em Período aberto",
        texto: `O novo ${avaliacoes ? "valor inicial" : "Alvo padrão"} vale para os Participantes que entrarem nas próximas Metas deste Tipo.`,
      }}
      aplicar={async (marcados) => {
        const aplicacoes = periodos.filter((p) => (marcados[p.id] ?? []).length > 0).map((p) => ({ metaId: p.metaId, version: p.version, codigos: marcados[p.id] }));
        await apiFetch(`${BASE}/${tipo.id}/aplicar-alvo-padrao`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ aplicacoes }) });
        feedback.notify({ type: "success", title: avaliacoes ? "Valor inicial aplicado." : "Alvo padrão aplicado." });
      }}
    />
  );
}

/** Janela "Definir Alvo" (ou "Definir valor inicial") de uma Meta do Período: o mesmo valor para os Participantes marcados. */
export function DefinirAlvoWindow({ indicadorId, meta }: { indicadorId: IndicadorId; meta: PeriodoComMeta }) {
  const { feedback } = useUi();
  const avaliacoes = indicadorId === "avaliacoes";
  return (
    <EscolhaDeParticipantes
      indicadorId={indicadorId}
      periodos={[meta]}
      vazio={{ titulo: "Nenhum Participante", texto: "Marque os Colaboradores que participam da Meta antes de definir o valor." }}
      aplicar={async (marcados, alvo) => {
        await apiFetch(`/api/m/inovafarma/metas/${meta.metaId}/definir-alvo`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ version: meta.version, codigos: marcados[meta.id] ?? [], alvo }),
        });
        feedback.notify({ type: "success", title: avaliacoes ? "Valor inicial definido." : "Alvo definido." });
      }}
    />
  );
}
