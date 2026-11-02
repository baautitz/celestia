import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import type { ResultadoParticipante } from "./apuracao";
import type { TipoApuracao } from "./apuracao-store";
import type { LojaMetas, PeriodoMetas } from "./montar-metas-tab";

const TODAS = "todas";

export interface VisualizacaoMetas {
  id: "geral" | "loja";
  /** Lojas que a Visualização filtra: todas na Geral, as do Vínculo do Usuário na Loja. */
  lojas: LojaMetas[];
}

interface LinhaAcompanhamento extends ResultadoParticipante {
  metaId: string;
  tipo: TipoApuracao;
}

interface Acompanhamento {
  congelada: boolean;
  apuradoEm: string;
  linhas: LinhaAcompanhamento[];
  totais: { codigoColaborador: number; nome: string; premioCentavos: number }[];
}

const VISUALIZACAO_LABEL = { geral: "Geral", loja: "Loja" } as const;
const periodoInicial = (periodos: PeriodoMetas[]) => (periodos.find((p) => p.status === "open") ?? periodos[0])?.id ?? "";

const colunas: DataTableColumn<LinhaAcompanhamento>[] = [
  { key: "meta", label: "Meta", value: (l) => l.tipo.nome, searchable: true, sortable: true, nowrap: true },
  { key: "colaborador", label: "Colaborador", value: (l) => l.nome, searchable: true, sortable: true, nowrap: true, mobileRole: "primary" },
  { key: "resultado", label: "Resultado", value: (l) => l.resultado },
  {
    key: "situacao",
    label: "Situação",
    value: (l) => (l.atingida === null ? "" : l.atingida ? "Atingida" : "Não atingida"),
    render: (l) => (l.atingida === null ? null : <Badge variant={l.atingida ? "default" : "outline"}>{l.atingida ? "Atingida" : "Não atingida"}</Badge>),
  },
  { key: "atingimento", label: "Atingimento", value: (l) => (l.atingimento === null || !Number.isFinite(l.atingimento) ? null : l.atingimento), format: "percent", sortable: true },
  { key: "premio", label: "Prêmio", value: (l) => l.premioCentavos / 100, format: "currency", sortable: true },
];

const colunasTotais: DataTableColumn<Acompanhamento["totais"][number]>[] = [
  { key: "colaborador", label: "Colaborador", value: (t) => t.nome, searchable: true, sortable: true, mobileRole: "primary" },
  { key: "premio", label: "Total de Prêmios", value: (t) => t.premioCentavos / 100, format: "currency", sortable: true },
];

/** Aba Acompanhamento: Realizado, Atingimento e Prêmio de cada Participante, com o total por Colaborador. */
export function AcompanhamentoMetas({ periodos, visualizacoes }: { periodos: PeriodoMetas[]; visualizacoes: VisualizacaoMetas[] }) {
  const { feedback } = useUi();
  const [periodoId, setPeriodoId] = useState(() => periodoInicial(periodos));
  const [visualizacao, setVisualizacao] = useState(visualizacoes[0]?.id ?? "geral");
  const [loja, setLoja] = useState(TODAS);
  const [dados, setDados] = useState<Acompanhamento | null>(null);
  const [carregando, setCarregando] = useState(false);
  const consulta = useRef(0);
  const periodo = periodos.find((p) => p.id === periodoId);
  const lojas = visualizacoes.find((v) => v.id === visualizacao)?.lojas ?? [];

  const carregar = useCallback(async () => {
    if (!periodoId) return;
    const minha = ++consulta.current;
    setCarregando(true);
    const filtro = loja === TODAS ? "" : `&codigoEmpresa=${encodeURIComponent(loja)}`;
    try {
      const a = await apiFetch<Acompanhamento>(`/api/m/inovafarma/metas/acompanhamento?periodoId=${encodeURIComponent(periodoId)}&visualizacao=${visualizacao}${filtro}`);
      if (minha === consulta.current) setDados(a);
    } catch (err: unknown) {
      if (minha === consulta.current) {
        setDados(null);
        feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar o Acompanhamento."));
      }
    } finally {
      if (minha === consulta.current) setCarregando(false);
    }
  }, [periodoId, visualizacao, loja, feedback]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (periodos.length === 0)
    return (
      <Alert>
        <AlertTitle>Nenhum Período de Fechamento</AlertTitle>
        <AlertDescription>Crie um Período de Fechamento para acompanhar as Metas.</AlertDescription>
      </Alert>
    );

  const lojaLabel = loja === TODAS ? (visualizacao === "geral" ? "Todas as Lojas" : "Minhas Lojas") : lojas.find((l) => String(l.codigo) === loja)?.nome || `Loja ${loja}`;
  const impressao = periodo ? `${periodo.name} · ${lojaLabel}${dados?.congelada ? " · Apuração gravada no fechamento" : ""}` : undefined;
  return (
    <Stack gap="section">
      <Stack direction="row" align="end" gap="section" wrap>
        <Stack gap="field">
          <Label>Período de Fechamento</Label>
          <Select value={periodoId} onValueChange={(v) => v && setPeriodoId(v)}>
            <SelectTrigger aria-label="Período de Fechamento">
              <SelectValue>{(id: string) => periodos.find((p) => p.id === id)?.name ?? "Selecione"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {periodos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.status === "closed" ? " · fechado" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Stack>
        {visualizacoes.length > 1 && (
          <Stack gap="field">
            <Label>Visualização</Label>
            <Select
              value={visualizacao}
              onValueChange={(v) => {
                if (v !== "geral" && v !== "loja") return;
                setVisualizacao(v);
                setLoja(TODAS);
              }}
            >
              <SelectTrigger aria-label="Visualização">
                <SelectValue>{(v: "geral" | "loja") => VISUALIZACAO_LABEL[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {visualizacoes.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {VISUALIZACAO_LABEL[v.id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Stack>
        )}
        <Stack gap="field">
          <Label>Loja</Label>
          <Select value={loja} onValueChange={(v) => v && setLoja(v)}>
            <SelectTrigger aria-label="Loja">
              <SelectValue>{() => lojaLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>{visualizacao === "geral" ? "Todas as Lojas" : "Minhas Lojas"}</SelectItem>
              {lojas.map((l) => (
                <SelectItem key={l.codigo} value={String(l.codigo)}>
                  {l.nome || `Loja ${l.codigo}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Stack>
      </Stack>
      {dados?.congelada && (
        <Alert>
          <AlertTitle>Apuração gravada no fechamento</AlertTitle>
          <AlertDescription>O Período está fechado: o resultado não muda com alterações no ERP. Reabra o Período para apurar de novo.</AlertDescription>
        </Alert>
      )}
      <DataTable
        columns={colunas}
        rows={dados?.linhas ?? []}
        getRowId={(l) => `${l.metaId}-${l.codigoColaborador}`}
        loading={carregando}
        title="Acompanhamento"
        description={periodo?.status === "open" ? "Apuração ao vivo: o resultado acompanha as vendas do ERP até o fechamento do Período." : undefined}
        emptyMessage="Nenhum Participante nas Metas deste Período e filtro."
        search={{ placeholder: "Buscar Meta ou Colaborador" }}
        striped
        print={{ orientation: "landscape", description: impressao, fileName: periodo ? `Acompanhamento de Metas - ${periodo.name} - ${lojaLabel}` : undefined }}
      />
      <DataTable
        columns={colunasTotais}
        rows={dados?.totais ?? []}
        getRowId={(t) => String(t.codigoColaborador)}
        loading={carregando}
        title="Total de Prêmios por Colaborador"
        emptyMessage="Nenhum Prêmio neste Período e filtro."
        totals={(rows) => ({ colaborador: "Total", premio: rows.reduce((acc, t) => acc + t.premioCentavos / 100, 0) })}
        print={{ description: impressao, fileName: periodo ? `Prêmios de Metas - ${periodo.name} - ${lojaLabel}` : undefined }}
      />
    </Stack>
  );
}
