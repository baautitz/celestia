import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Label } from "@platform/ui/components/label";
import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@platform/ui/components/select";
import {
  DataTable,
  PrintDetailTable,
  type DataTableColumn,
} from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import type { ResultadoParticipante } from "./apuracao";
import type { TipoApuracao } from "./apuracao-store";
import type { LojaMetas, PeriodoMetas } from "./montar-metas-tab";
import { OlhoAvaliacoes } from "./avaliacoes-do-colaborador";
import { formatarValor } from "./indicadores";
import { useVisaoMetas, VisaoSelect } from "./metas-visualizacao";
import { indicadorDoTipo } from "./tipos-meta";
import { hojeLocal, projetar, type PeriodoDaProjecao } from "./projecao";
import { Stack, Text } from "@platform/ui/components/layout";
import { Tooltip, TooltipContent, TooltipTrigger } from "@platform/ui/components/tooltip";

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
const periodoInicial = (periodos: PeriodoMetas[]) =>
  (periodos.find((p) => p.status === "open") ?? periodos[0])?.id ?? "";

/** Olho das Avaliações na Meta de Avaliações; null quando o Usuário não pode lê-las. */
type Olho = (l: LinhaAcompanhamento) => ReactNode;

const comOlho = (olho: Olho | null, l: LinhaAcompanhamento, conteudo: ReactNode) =>
  olho && l.tipo.indicador === "avaliacoes" ? (
    <Stack direction="row" gap="tight" align="center">
      {conteudo}
      {olho(l)}
    </Stack>
  ) : (
    conteudo
  );

/** Projeção até o fim do Período, com a dica no tooltip: verde se atinge o Alvo no ritmo atual. */
function CelulaProjecao({ linha, periodo }: { linha: LinhaAcompanhamento; periodo: PeriodoDaProjecao | null }) {
  if (!periodo) return null;
  const indicador = indicadorDoTipo(linha.tipo);
  const p = projetar(indicador, linha.realizado, linha.alvo, periodo, hojeLocal());
  if (!p) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<Text variant="small" tone={p.atinge === null ? "default" : p.atinge ? "success" : "destructive"} />}>
        {formatarValor(indicador, p.valor)}
      </TooltipTrigger>
      <TooltipContent>{p.dica}</TooltipContent>
    </Tooltip>
  );
}

const colunaProjecao = <T,>(key: string, linha: (r: T) => LinhaAcompanhamento | undefined, periodo: PeriodoDaProjecao | null, group?: string): DataTableColumn<T> => ({
  key,
  group,
  label: "Projeção",
  tooltip: "Onde termina o Período no ritmo atual. Passe o mouse para ver o que falta para atingir o Alvo.",
  value: (r) => {
    const l = linha(r);
    const p = l && periodo ? projetar(indicadorDoTipo(l.tipo), l.realizado, l.alvo, periodo, hojeLocal()) : null;
    return p ? formatarValor(indicadorDoTipo(l!.tipo), p.valor) : "";
  },
  render: (r) => {
    const l = linha(r);
    return l ? <CelulaProjecao linha={l} periodo={periodo} /> : null;
  },
  nowrap: true,
});

/** As Metas de um Colaborador (ou os Participantes de uma Meta), na linha expandida. */
const colunasDe = (olho: Olho | null, primeira: "meta" | "colaborador" = "meta", periodo: PeriodoDaProjecao | null = null): DataTableColumn<LinhaAcompanhamento>[] => [
  primeira === "meta"
    ? { key: "meta", label: "Meta", value: (l) => l.tipo.nome, sortable: true, nowrap: true, mobileRole: "primary" }
    : { key: "colaborador", label: "Colaborador", value: (l) => l.nome, searchable: true, sortable: true, mobileRole: "primary" },
  { key: "resultado", label: "Resultado", value: (l) => l.resultado, render: (l) => comOlho(olho, l, l.resultado) },
  ...(periodo ? [colunaProjecao<LinhaAcompanhamento>("projecao", (l) => l, periodo)] : []),
  {
    key: "situacao",
    centered: true,
    label: "Situação",
    value: (l) =>
      l.atingida === null ? "" : l.atingida ? "Atingida" : "Não atingida",
    render: (l) =>
      l.atingida === null ? null : (
        <Badge variant={l.atingida ? "default" : "outline"}>
          {l.atingida ? "Atingida" : "Não atingida"}
        </Badge>
      ),
  },
  {
    key: "atingimento",
    label: "% Atingido",
    value: (l) =>
      l.atingimento === null || !Number.isFinite(l.atingimento)
        ? null
        : l.atingimento,
    format: "percent",
    sortable: true,
  },
  {
    key: "premio",
    label: "Prêmio",
    value: (l) => l.premioCentavos / 100,
    format: "currency",
    sortable: true,
  },
];
const colunas = colunasDe(null);

/** Uma linha por Colaborador; expande para as Metas dele. */
interface LinhaColaborador {
  codigoColaborador: number;
  nome: string;
  premioCentavos: number;
  metas: LinhaAcompanhamento[];
}

const colunasColaborador: DataTableColumn<LinhaColaborador>[] = [
  {
    key: "colaborador",
    label: "Colaborador",
    value: (c) => c.nome,
    searchable: true,
    sortable: true,
    mobileRole: "primary",
  },
  {
    key: "metas",
    label: "Metas",
    value: (c) => c.metas.length,
    format: "number",
    sortable: true,
  },
  { key: "atingidas", label: "Atingidas", value: (c) => c.metas.filter((m) => m.atingida === true).length, format: "number", sortable: true },
  {
    key: "premio",
    label: "Total de Prêmios",
    value: (c) => c.premioCentavos / 100,
    format: "currency",
    sortable: true,
  },
];

const porColaborador = (dados: Acompanhamento | null): LinhaColaborador[] =>
  !dados
    ? []
    : dados.totais
        .map((t) => ({
          ...t,
          metas: dados.linhas.filter(
            (l) => l.codigoColaborador === t.codigoColaborador,
          ),
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome));

/** Uma linha por Meta; expande para os Participantes. */
interface LinhaMeta {
  metaId: string;
  tipo: TipoApuracao;
  participantes: LinhaAcompanhamento[];
  premioCentavos: number;
}

const porMeta = (dados: Acompanhamento | null): LinhaMeta[] => {
  const metas = new Map<string, LinhaMeta>();
  for (const l of dados?.linhas ?? []) {
    const m = metas.get(l.metaId) ?? { metaId: l.metaId, tipo: l.tipo, participantes: [], premioCentavos: 0 };
    m.participantes.push(l);
    m.premioCentavos += l.premioCentavos;
    metas.set(l.metaId, m);
  }
  return [...metas.values()].sort((a, b) => a.tipo.nome.localeCompare(b.tipo.nome));
};

const colunasMeta: DataTableColumn<LinhaMeta>[] = [
  { key: "meta", label: "Meta", value: (m) => m.tipo.nome, searchable: true, sortable: true, mobileRole: "primary" },
  { key: "participantes", label: "Participantes", value: (m) => m.participantes.length, format: "number", sortable: true },
  { key: "atingidas", label: "Atingidas", value: (m) => m.participantes.filter((p) => p.atingida === true).length, format: "number", sortable: true },
  { key: "premio", label: "Total de Prêmios", value: (m) => m.premioCentavos / 100, format: "currency", sortable: true },
];

/** Visualização Tabela: uma linha por Colaborador; cada Meta mostra Alvo, Realizado e % Atingido. */
function colunasTabela(metas: LinhaMeta[], olho: Olho | null, periodo: PeriodoDaProjecao | null): DataTableColumn<LinhaColaborador>[] {
  const colunas: DataTableColumn<LinhaColaborador>[] = [
    { key: "colaborador", label: "Colaborador", value: (c) => c.nome, searchable: true, sortable: true, mobileRole: "primary", nowrap: true },
  ];
  for (const meta of metas) {
    const indicador = indicadorDoTipo(meta.tipo);
    const linha = (c: LinhaColaborador) => c.metas.find((l) => l.metaId === meta.metaId);
    const group = meta.tipo.nome;
    const avaliacoes = meta.tipo.indicador === "avaliacoes";
    if (!meta.tipo.semAlvo)
      colunas.push({
        key: `${meta.metaId}:alvo`,
        group,
        label: avaliacoes ? "Valor inicial" : "Alvo",
        value: (c) => {
          const l = linha(c);
          return l && l.alvo !== null ? formatarValor(indicador, l.alvo) : "";
        },
        nowrap: true,
      });
    colunas.push({
      key: `${meta.metaId}:realizado`,
      group,
      label: avaliacoes ? "Saldo" : "Realizado",
      value: (c) => {
        const l = linha(c);
        return l ? formatarValor(indicador, l.realizado) : "";
      },
      render: (c) => {
        const l = linha(c);
        return l ? comOlho(olho, l, formatarValor(indicador, l.realizado)) : null;
      },
      nowrap: true,
    });
    if (!meta.tipo.semAlvo)
      colunas.push({
        key: `${meta.metaId}:atingimento`,
        group,
        label: "% Atingido",
        value: (c) => {
          const a = linha(c)?.atingimento;
          return a === null || a === undefined || !Number.isFinite(a) ? null : a;
        },
        format: "percent",
        sortable: true,
      });
    if (meta.tipo.indicador !== "avaliacoes") colunas.push(colunaProjecao<LinhaColaborador>(`${meta.metaId}:projecao`, linha, periodo, group));
  }
  colunas.push({ key: "premio", label: "Total de Prêmios", value: (c) => c.premioCentavos / 100, format: "currency", sortable: true });
  return colunas;
}

/** Aba Acompanhamento: Realizado, % Atingido e Prêmio de cada Participante, com o total por Colaborador. */
export function AcompanhamentoMetas({
  periodos,
  visualizacoes,
  lerAvaliacoes = false,
}: {
  periodos: PeriodoMetas[];
  visualizacoes: VisualizacaoMetas[];
  /** Quem gerencia as Avaliações ganha o olho para lê-las na Meta de Avaliações. */
  lerAvaliacoes?: boolean;
}) {
  const { visao, salvar: salvarVisao, disponiveis } = useVisaoMetas("acompanhamento", ["table", "by-colaborador", "by-meta"], "by-colaborador");
  const { feedback } = useUi();
  const [periodoId, setPeriodoId] = useState(() => periodoInicial(periodos));
  const [visualizacao, setVisualizacao] = useState(
    visualizacoes[0]?.id ?? "geral",
  );
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
    const filtro =
      loja === TODAS ? "" : `&codigoEmpresa=${encodeURIComponent(loja)}`;
    try {
      const a = await apiFetch<Acompanhamento>(
        `/api/m/inovafarma/metas/acompanhamento?periodoId=${encodeURIComponent(periodoId)}&visualizacao=${visualizacao}${filtro}`,
      );
      if (minha === consulta.current) setDados(a);
    } catch (err: unknown) {
      if (minha === consulta.current) {
        setDados(null);
        feedback.notifyError(
          err instanceof Error
            ? err
            : new Error("Erro ao carregar o Acompanhamento."),
        );
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
        <AlertDescription>
          Crie um Período de Fechamento para acompanhar as Metas.
        </AlertDescription>
      </Alert>
    );

  const lojaLabel =
    loja === TODAS
      ? visualizacao === "geral"
        ? "Todas as Lojas"
        : "Minhas Lojas"
      : lojas.find((l) => String(l.codigo) === loja)?.nome || `Loja ${loja}`;
  const olho: Olho | null = lerAvaliacoes
    ? (l) => <OlhoAvaliacoes periodoId={periodoId} codigoColaborador={l.codigoColaborador} nome={l.nome} acesso="gerenciar" />
    : null;
  const colunasExpandidas = colunasDe(olho, "meta", periodo ?? null);
  const metasAgrupadas = porMeta(dados);
  const linhasColaborador = porColaborador(dados);
  const impressao = periodo
    ? `${periodo.name} · ${lojaLabel}${dados?.congelada ? " · Apuração gravada no fechamento" : ""}`
    : undefined;
  return (
    <Stack gap="section">
      <Stack direction="row" align="end" gap="section" wrap>
        <VisaoSelect visao={visao} disponiveis={disponiveis} onChange={salvarVisao} />
        <Stack gap="field">
          <Label>Período de Fechamento</Label>
          <Select value={periodoId} onValueChange={(v) => v && setPeriodoId(v)}>
            <SelectTrigger aria-label="Período de Fechamento">
              <SelectValue>
                {(id: string) =>
                  periodos.find((p) => p.id === id)?.name ?? "Selecione"
                }
              </SelectValue>
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
                <SelectValue>
                  {(v: "geral" | "loja") => VISUALIZACAO_LABEL[v]}
                </SelectValue>
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
              <SelectItem value={TODAS}>
                {visualizacao === "geral" ? "Todas as Lojas" : "Minhas Lojas"}
              </SelectItem>
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
          <AlertDescription>
            O Período está fechado: o resultado não muda com alterações no ERP.
            Reabra o Período para apurar de novo.
          </AlertDescription>
        </Alert>
      )}
      {visao === "table" && (
        <DataTable
          scroll="page"
          columns={colunasTabela(metasAgrupadas, olho, periodo ?? null)}
          rows={linhasColaborador}
          getRowId={(c) => String(c.codigoColaborador)}
          loading={carregando}
          title="Acompanhamento"
          description={
            periodo?.status === "open"
              ? "Apuração ao vivo: o resultado acompanha as vendas do ERP até o fechamento do Período."
              : undefined
          }
          emptyMessage="Nenhum Participante nas Metas deste Período e filtro."
          search={{ placeholder: "Buscar Colaborador" }}
          frozenUntil="colaborador"
          striped
          totals={(rows) => ({
            colaborador: "Total",
            premio: rows.reduce((acc, c) => acc + c.premioCentavos / 100, 0),
          })}
          print={{
            orientation: "landscape",
            description: impressao,
            fileName: periodo ? `Acompanhamento de Metas - ${periodo.name} - ${lojaLabel}` : undefined,
          }}
        />
      )}
      {visao === "by-meta" && (
        <DataTable
          scroll="page"
          columns={colunasMeta}
          rows={metasAgrupadas}
          getRowId={(m) => m.metaId}
          loading={carregando}
          title="Acompanhamento"
          emptyMessage="Nenhum Participante nas Metas deste Período e filtro."
          search={{ placeholder: "Buscar Meta" }}
          striped
          totals={(rows) => ({
            meta: "Total",
            premio: rows.reduce((acc, m) => acc + m.premioCentavos / 100, 0),
          })}
          print={{
            orientation: "landscape",
            details: (m) => (
              <PrintDetailTable columns={colunasDe(null, "colaborador")} rows={m.participantes} getRowId={(l) => String(l.codigoColaborador)} />
            ),
            description: impressao,
            fileName: periodo ? `Acompanhamento de Metas - ${periodo.name} - ${lojaLabel}` : undefined,
          }}
          renderExpanded={(m) => (
            <DataTable
              scroll="page"
              columns={colunasDe(olho, "colaborador", periodo ?? null)}
              rows={m.participantes}
              getRowId={(l) => String(l.codigoColaborador)}
            />
          )}
        />
      )}
      {visao === "by-colaborador" && <DataTable
        scroll="page"
        columns={colunasColaborador}
        rows={linhasColaborador}
        getRowId={(c) => String(c.codigoColaborador)}
        loading={carregando}
        title="Acompanhamento"
        description={
          periodo?.status === "open"
            ? "Apuração ao vivo: o resultado acompanha as vendas do ERP até o fechamento do Período."
            : undefined
        }
        emptyMessage="Nenhum Participante nas Metas deste Período e filtro."
        search={{ placeholder: "Buscar Colaborador" }}
        striped
        totals={(rows) => ({
          colaborador: "Total",
          premio: rows.reduce((acc, c) => acc + c.premioCentavos / 100, 0),
        })}
        print={{
          orientation: "landscape",
          details: (c) => (
            <PrintDetailTable
              columns={colunas}
              rows={c.metas}
              getRowId={(l) => l.metaId}
            />
          ),
          description: impressao,
          fileName: periodo
            ? `Acompanhamento de Metas - ${periodo.name} - ${lojaLabel}`
            : undefined,
        }}
        defaultExpanded
        renderExpanded={(c) => (
          <DataTable
            scroll="page"
            columns={colunasExpandidas}
            rows={c.metas}
            getRowId={(l) => l.metaId}
          />
        )}
      />}
    </Stack>
  );
}
