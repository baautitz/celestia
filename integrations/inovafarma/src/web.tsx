import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { TrendingUp, RefreshCw, Calendar, Store, Users, DollarSign, Award, AlertCircle, Package, Pill, SlidersHorizontal } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Button } from "@platform/ui/components/button";
import { Badge } from "@platform/ui/components/badge";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Grid, KpiCard, Show, Spin, Stack, Text } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { defineWebModule } from "@platform/ui/contracts/module";
import { formatCurrency, formatDecimal, formatNumber, formatDate, formatPercent } from "@platform/ui/lib/format";
import { apiFetch } from "@platform/ui/lib/api";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import type { Trend } from "@platform/ui/components/trend";
import { ColaboradoresPendentesBadge } from "./colaboradores-badge";
import { ColaboradoresPage } from "./colaboradores-page";
import { colaboradoresTotals, colaboradoresTotalsCompare } from "./colaboradores-totals";
import { previousClosingPeriodRange, type ClosingPeriod } from "./previous-closing-period";

interface Loja {
  codigoEmpresa: number;
  nome: string;
}

type Categoria = "vitaminas" | "genericos" | "similares" | "incentivos" | "totalFoco";
type CategoriaTotais = Record<Categoria, { quantidade: number; valor: number }>;

/** Categorias de produto exibidas com Qtde e Valor; os IDs ficam fixos no servidor do Plugin. */
const CATEGORIAS: { key: Categoria; label: string; tooltip: string }[] = [
  { key: "vitaminas", label: "Vitaminas", tooltip: "Itens do grupo de produto VITAMINAS (44)." },
  { key: "genericos", label: "Genéricos", tooltip: "Itens da seção de produto GENERICOS (261)." },
  { key: "similares", label: "Similares", tooltip: "Itens da seção de produto SIMILARES (271)." },
  { key: "incentivos", label: "Incentivos", tooltip: "Itens da seção de produto INCENTIVOS (281)." },
  {
    key: "totalFoco",
    label: "Total Foco",
    tooltip:
      "Itens de Vitaminas, Genéricos, Similares ou Incentivos, contados uma vez: uma Vitamina que também é de Similares ou Incentivos não entra em dobro, por isso pode ficar abaixo da soma das colunas.",
  },
];

interface ColaboradorItem {
  codigoColaborador: number;
  nomeColaborador: string;
  quantidadeVendas: number;
  totalBruto: number;
  totalDesconto: number;
  totalLiquido: number;
  totalCmv: number;
  cmvPercent: number;
  ticketMedio: number;
  participacaoPercent: number;
  cadastroPercent: number;
  categorias: CategoriaTotais;
}

interface ResumoVendas {
  totalVendasGeral: number;
  totalLiquidoGeral: number;
  totalBrutoGeral: number;
  totalDescontoGeral: number;
  totalCmvGeral: number;
  cmvPercentGeral: number;
  cadastroPercentGeral: number;
  totalColaboradores: number;
  categorias: CategoriaTotais;
}

interface RelatorioVendas {
  resumo: ResumoVendas;
  colaboradores: ColaboradorItem[];
}

/** Relatório do Período anterior, base das comparações dos KPIs e da tabela. */
interface Anterior {
  label: string;
  resumo: ResumoVendas;
  colaboradores: Map<number, ColaboradorItem>;
}

/** Colunas e KPIs em que subir é ruim (`down`) ou só acompanha as vendas (`neutral`). */
const FAVORABLE = {
  totalDesconto: "down",
  totalCmv: "neutral",
  cmvPercent: "down",
} satisfies Partial<Record<keyof ColaboradorItem, Trend["favorable"]>>;
const favorableByColumn: Partial<Record<string, Trend["favorable"]>> = FAVORABLE;

const ticketMedio = (r: ResumoVendas) => (r.totalVendasGeral > 0 ? r.totalLiquidoGeral / r.totalVendasGeral : 0);

/** Data local de hoje em `YYYY-MM-DD`. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Compara cada coluna numérica com o mesmo Colaborador no Período anterior. */
function withComparison(cols: DataTableColumn<ColaboradorItem>[], anterior: Anterior | null): DataTableColumn<ColaboradorItem>[] {
  if (!anterior) return cols;
  return cols.map((col) => {
    const value = col.value;
    if (!col.format || !value) return col;
    return {
      ...col,
      compare: (r) => {
        const previous = anterior.colaboradores.get(r.codigoColaborador);
        return previous && { previous: Number(value(previous)), label: anterior.label, favorable: favorableByColumn[col.key] };
      },
    };
  });
}

const columns: DataTableColumn<ColaboradorItem>[] = [
  {
    key: "codigoColaborador",
    label: "Cód.",
    tooltip: "Código do Colaborador no ERP.",
    value: (r) => r.codigoColaborador,
    sortable: true,
    searchable: true,
    cellClassName: "font-mono text-xs w-20",
  },
  {
    key: "nomeColaborador",
    label: "Colaborador",
    tooltip: "Colaborador que vendeu o item.",
    value: (r) => r.nomeColaborador,
    sortable: true,
    searchable: true,
    nowrap: true,
    cellClassName: "font-medium",
  },
  {
    key: "quantidadeVendas",
    label: "Qtd. Vendas",
    tooltip: "Vendas distintas com ao menos um item do Colaborador.",
    value: (r) => r.quantidadeVendas,
    format: "number",
    sortable: true,
    firstSort: "desc",
    cellClassName: "text-right font-mono",
  },
  {
    key: "totalBruto",
    label: "Total Bruto (R$)",
    tooltip: "Soma dos itens vendidos, antes dos descontos.",
    value: (r) => r.totalBruto,
    format: "decimal",
    sortable: true,
    firstSort: "desc",
    cellClassName: "text-right font-mono",
  },
  {
    key: "totalDesconto",
    label: "Descontos (R$)",
    tooltip: "Soma dos descontos concedidos nos itens.",
    value: (r) => r.totalDesconto,
    format: "decimal",
    sortable: true,
    firstSort: "desc",
    cellClassName: "text-right font-mono",
  },
  {
    key: "totalLiquido",
    label: "Total Líquido (R$)",
    tooltip: "Total Bruto menos os descontos.",
    value: (r) => r.totalLiquido,
    format: "decimal",
    sortable: true,
    firstSort: "desc",
    cellClassName: "text-right font-mono font-semibold",
  },
  {
    key: "totalCmv",
    label: "CMV (R$)",
    tooltip: "Custo das mercadorias vendidas: quantidade × preço de custo.",
    value: (r) => r.totalCmv,
    format: "decimal",
    sortable: true,
    firstSort: "desc",
    cellClassName: "text-right font-mono",
  },
  {
    key: "cmvPercent",
    label: "CMV (%)",
    tooltip: "CMV dividido pelo Total Líquido.",
    value: (r) => r.cmvPercent,
    format: "percent",
    sortable: true,
    firstSort: "desc",
    cellClassName: "text-right font-mono",
  },
  {
    key: "ticketMedio",
    label: "Ticket Médio (R$)",
    tooltip: "Total Líquido dividido pela quantidade de vendas.",
    value: (r) => r.ticketMedio,
    format: "decimal",
    sortable: true,
    firstSort: "desc",
    cellClassName: "text-right font-mono",
  },
  {
    key: "participacaoPercent",
    label: "Vendas (%)",
    tooltip: "Participação do Colaborador no Total Líquido geral.",
    value: (r) => r.participacaoPercent,
    format: "percent",
    sortable: true,
    firstSort: "desc",
    cellClassName: "text-right font-mono",
  },
  {
    key: "cadastroPercent",
    label: "Cadastros (%)",
    tooltip: "Vendas com cliente cadastrado divididas pela quantidade de vendas. Vendas para \"CONSUMIDOR\" não contam.",
    value: (r) => r.cadastroPercent,
    format: "percent",
    sortable: true,
    firstSort: "desc",
    cellClassName: "text-right font-mono",
  },
  ...CATEGORIAS.flatMap(({ key, label, tooltip }): DataTableColumn<ColaboradorItem>[] => [
    {
      key: `${key}-quantidade`,
      label: "Qtde",
      group: label,
      tooltip: `${tooltip} Unidades vendidas.`,
      value: (r) => r.categorias[key].quantidade,
      render: (r) => (r.categorias[key].quantidade === 0 ? "-" : formatNumber(r.categorias[key].quantidade)),
      format: "number",
      sortable: true,
      firstSort: "desc",
      cellClassName: "text-right font-mono",
    },
    {
      key: `${key}-valor`,
      label: "Valor (R$)",
      group: label,
      tooltip: `${tooltip} Valor líquido vendido.`,
      value: (r) => r.categorias[key].valor,
      render: (r) => (r.categorias[key].valor === 0 ? "-" : formatDecimal(r.categorias[key].valor)),
      format: "decimal",
      sortable: true,
      firstSort: "desc",
      cellClassName: "text-right font-mono",
    },
  ]),
];

interface Filtros {
  periodId: string;
  loja: string;
}

const periodLabel = (p: ClosingPeriod) => `${p.name} (${formatDate(p.startDate)} a ${formatDate(p.endDate)})`;

const lojaLabel = (lojas: Loja[], loja: string) =>
  loja === "all" ? "Todas as Filiais" : lojas.find((l) => String(l.codigoEmpresa) === loja)?.nome || `Filial ${loja}`;

function StatusBadge({ status }: { status: ClosingPeriod["status"] }) {
  return (
    <Badge variant={status === "open" ? "secondary" : "outline"}>
      {status === "open" ? "Aberto" : status === "closed" ? "Fechado" : "Cancelado"}
    </Badge>
  );
}

/** Campo de filtro: rótulo com ícone acima do controle. */
function FiltroSelect({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <Stack gap="field" grow narrow>
      <Stack direction="row" align="center" gap="field" iconSize="sm">
        {icon}
        <Text variant="caption" tone="muted" weight="medium">
          {label}
        </Text>
      </Stack>
      {children}
    </Stack>
  );
}

/** Seletores de Período de Fechamento e Filial, na barra do desktop e no drawer do celular. */
function FiltrosCampos({
  periods,
  lojas,
  value,
  onChange,
}: {
  periods: ClosingPeriod[];
  lojas: Loja[];
  value: Filtros;
  onChange: (next: Filtros) => void;
}) {
  const period = periods.find((p) => p.id === value.periodId);
  return (
    <>
      <FiltroSelect icon={<Calendar />} label="Período de Fechamento">
        <Select value={value.periodId} onValueChange={(val) => val && onChange({ ...value, periodId: val })}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um período">{period ? periodLabel(period) : "Selecione um Período"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {periodLabel(p)}
              </SelectItem>
            ))}
            {periods.length === 0 && (
              <Stack padding="compact" align="center">
                <Text variant="caption" tone="muted">
                  Nenhum período cadastrado
                </Text>
              </Stack>
            )}
          </SelectContent>
        </Select>
      </FiltroSelect>

      <FiltroSelect icon={<Store />} label="Filial / Loja">
        <Select value={value.loja} onValueChange={(val) => val && onChange({ ...value, loja: val })}>
          <SelectTrigger>
            <SelectValue placeholder="Todas as Filiais">{lojaLabel(lojas, value.loja)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as Filiais</SelectItem>
            {lojas.map((l) => (
              <SelectItem key={l.codigoEmpresa} value={String(l.codigoEmpresa)}>
                {l.codigoEmpresa} - {l.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FiltroSelect>
    </>
  );
}

/** Filtros no drawer do celular: só valem ao tocar em Aplicar, para não consultar o ERP a cada troca. */
function FiltrosDrawer({ periods, lojas, initial }: { periods: ClosingPeriod[]; lojas: Loja[]; initial: Filtros }) {
  const { resolve } = useWindow<Filtros>();
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <FiltrosCampos periods={periods} lojas={lojas} value={draft} onChange={setDraft} />
      <WindowActions>
        <WindowCancelButton />
        <Button onClick={() => resolve(draft)}>Aplicar</Button>
      </WindowActions>
    </>
  );
}

function VendasComissoesPage() {
  const ui = useUi();
  const [periods, setPeriods] = useState<ClosingPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [selectedLoja, setSelectedLoja] = useState<string>("all");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ResumoVendas | null>(null);
  const [colaboradores, setColaboradores] = useState<ColaboradorItem[]>([]);
  const [anterior, setAnterior] = useState<Anterior | null>(null);

  // Carrega lista de períodos de fechamento e filiais
  useEffect(() => {
    async function initFilters() {
      try {
        const [periodsData, lojasData] = await Promise.all([
          apiFetch<ClosingPeriod[]>("/api/closing-periods").catch((err) => {
            console.error("Erro ao buscar períodos:", err);
            return [] as ClosingPeriod[];
          }),
          apiFetch<Loja[]>("/api/m/inovafarma/lojas").catch((err) => {
            console.error("Erro ao buscar lojas:", err);
            return [] as Loja[];
          }),
        ]);

        setPeriods(periodsData);
        setLojas(lojasData);

        if (periodsData.length > 0) {
          const initial = periodsData.find((p) => p.status === "open") || periodsData[0];
          if (initial) setSelectedPeriodId((prev) => prev || initial.id);
        } else {
          setLoading(false);
        }
      } catch (err: unknown) {
        console.error("Falha ao inicializar filtros do InovaFarma:", err);
        setLoading(false);
      }
    }
    void initFilters();
  }, []);

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  const fetchRelatorio = useCallback(async () => {
    if (!selectedPeriod) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fetchVendas = (dataInicio: string, dataFim: string) => {
        const params = new URLSearchParams({ dataInicio, dataFim });
        if (selectedLoja !== "all") {
          params.append("codigoEmpresa", selectedLoja);
        }
        return apiFetch<RelatorioVendas>(`/api/m/inovafarma/relatorios/vendas-colaborador?${params.toString()}`);
      };
      const range = previousClosingPeriodRange(periods, selectedPeriod, today());

      // A comparação é opcional: se o anterior falhar, o relatório segue sem ela.
      const [data, previous] = await Promise.all([
        fetchVendas(selectedPeriod.startDate, selectedPeriod.endDate),
        range ? fetchVendas(range.startDate, range.endDate).catch(() => null) : null,
      ]);

      setResumo(data.resumo);
      setColaboradores(data.colaboradores || []);
      setAnterior(
        range && previous && previous.resumo.totalVendasGeral > 0
          ? {
              label: range.name,
              resumo: previous.resumo,
              colaboradores: new Map((previous.colaboradores || []).map((c) => [c.codigoColaborador, c])),
            }
          : null
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido ao carregar relatório.");
      setColaboradores([]);
      setResumo(null);
      setAnterior(null);
    } finally {
      setLoading(false);
    }
  }, [periods, selectedPeriod, selectedLoja]);

  useEffect(() => {
    if (selectedPeriodId) {
      void fetchRelatorio();
    }
  }, [selectedPeriodId, selectedLoja, fetchRelatorio]);

  const selectedLojaLabel = lojaLabel(lojas, selectedLoja);

  const filtros: Filtros = { periodId: selectedPeriodId, loja: selectedLoja };
  const applyFiltros = (next: Filtros) => {
    setSelectedPeriodId(next.periodId);
    setSelectedLoja(next.loja);
  };

  const openFiltros = async () => {
    const result = await ui.windows.open<Filtros>({
      surface: "drawer",
      title: "Filtros",
      content: () => <FiltrosDrawer periods={periods} lojas={lojas} initial={filtros} />,
    });
    if (result.status === "confirmed") applyFiltros(result.value);
  };

  const tableColumns = useMemo(() => withComparison(columns, anterior), [anterior]);

  const trend = (
    pick: (r: ResumoVendas) => number,
    format: Trend["format"],
    favorable?: Trend["favorable"]
  ): Trend | undefined =>
    resumo && anterior
      ? { current: pick(resumo), previous: pick(anterior.resumo), label: anterior.label, format, favorable }
      : undefined;

  return (
    <Stack gap="section">
      {/* Barra de Filtros (desktop) */}
      <Show on="lgUp">
        <Stack
          direction="row"
          wrap
          align="end"
          justify="between"
          gap="section"
          surface="card"
        >
          <Stack direction="row" wrap align="end" gap="section" grow>
            <FiltrosCampos periods={periods} lojas={lojas} value={filtros} onChange={applyFiltros} />

            {selectedPeriod && (
              <Stack direction="row" align="center" gap="field" height="control" surface="muted">
                <Text variant="caption" tone="muted">
                  Status:
                </Text>
                <StatusBadge status={selectedPeriod.status} />
              </Stack>
            )}
          </Stack>

          <Button variant="outline" size="default" onClick={() => void fetchRelatorio()} disabled={loading || !selectedPeriod}>
            <Spin active={loading}>
              <RefreshCw />
            </Spin>
            Atualizar
          </Button>
        </Stack>
      </Show>

      {/* Resumo dos filtros (celular): os selects abrem num drawer */}
      <Show on="belowLg">
        <Stack direction="row" align="center" justify="between" gap="group" surface="card">
          <Stack gap="tight">
            <Text variant="small" weight="semibold" truncate>
              {selectedPeriod?.name ?? "Selecione um Período"}
            </Text>
            <Text variant="caption" tone="muted" truncate>
              {selectedLojaLabel}
            </Text>
          </Stack>
          <Stack direction="row" align="center" gap="field" shrink={false}>
            {selectedPeriod && <StatusBadge status={selectedPeriod.status} />}
            <Button variant="outline" size="icon" aria-label="Filtros" title="Filtros" onClick={() => void openFiltros()}>
              <SlidersHorizontal />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Atualizar"
              title="Atualizar"
              onClick={() => void fetchRelatorio()}
              disabled={loading || !selectedPeriod}
            >
              <Spin active={loading}>
                <RefreshCw />
              </Spin>
            </Button>
          </Stack>
        </Stack>
      </Show>

      {/* Alerta se não houver períodos */}
      {periods.length === 0 && !loading && (
        <Alert>
          <AlertCircle />
          <AlertTitle>Nenhum Período de Fechamento cadastrado na plataforma.</AlertTitle>
          <AlertDescription>
            <a href="/closing-periods">Cadastrar Período</a>
          </AlertDescription>
        </Alert>
      )}

      {/* Erro de conexão ou consulta */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Falha na consulta InovaFarma:</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Cards de Resumo / KPI */}
      <Grid columns="cards">
        <KpiCard
          loading={loading}
          label="Qtd. Vendas"
          trend={trend((r) => r.totalVendasGeral, "number")}
          value={resumo ? formatNumber(resumo.totalVendasGeral) : "-"}
          hint={resumo ? `${formatNumber(resumo.totalColaboradores)} colaboradores com venda` : "-"}
          icon={<Users />}
          tone="info"
        />
        <KpiCard
          loading={loading}
          label="Total Bruto"
          trend={trend((r) => r.totalBrutoGeral, "currency")}
          value={formatCurrency(resumo?.totalBrutoGeral)}
          icon={<TrendingUp />}
          tone="primary"
        />
        <KpiCard
          loading={loading}
          label="Descontos"
          trend={trend((r) => r.totalDescontoGeral, "currency", FAVORABLE.totalDesconto)}
          value={formatCurrency(resumo?.totalDescontoGeral)}
          hint={
            resumo && resumo.totalBrutoGeral > 0
              ? `${formatPercent((resumo.totalDescontoGeral / resumo.totalBrutoGeral) * 100)} do Total Bruto`
              : "-"
          }
          icon={<TrendingUp />}
          tone="primary"
        />
        <KpiCard
          loading={loading}
          label="Total Líquido"
          trend={trend((r) => r.totalLiquidoGeral, "currency")}
          value={formatCurrency(resumo?.totalLiquidoGeral)}
          icon={<DollarSign />}
          tone="success"
        />
        <KpiCard
          loading={loading}
          label="CMV (R$)"
          trend={trend((r) => r.totalCmvGeral, "currency", FAVORABLE.totalCmv)}
          value={formatCurrency(resumo?.totalCmvGeral)}
          icon={<Package />}
          tone="primary"
        />
        <KpiCard
          loading={loading}
          label="CMV (%)"
          trend={trend((r) => r.cmvPercentGeral, "percent", FAVORABLE.cmvPercent)}
          value={resumo ? formatPercent(resumo.cmvPercentGeral) : "-"}
          hint="do Total Líquido"
          icon={<Package />}
          tone="primary"
        />
        <KpiCard
          loading={loading}
          label="Ticket Médio"
          trend={trend(ticketMedio, "currency")}
          value={resumo ? formatCurrency(ticketMedio(resumo)) : "R$ 0,00"}
          hint="Média por cupom de venda"
          icon={<Award />}
          tone="warning"
        />
        <KpiCard
          loading={loading}
          label="Cadastros (%)"
          trend={trend((r) => r.cadastroPercentGeral, "percent")}
          value={resumo ? formatPercent(resumo.cadastroPercentGeral) : "-"}
          hint="das vendas com cliente cadastrado"
          icon={<Users />}
          tone="info"
        />
        {CATEGORIAS.map(({ key, label }) => (
          <KpiCard
            key={key}
            loading={loading}
            label={label}
            trend={trend((r) => r.categorias[key].valor, "currency")}
            value={formatCurrency(resumo?.categorias[key].valor)}
            hint={resumo ? `${formatNumber(resumo.categorias[key].quantidade)} un` : "-"}
            icon={<Pill />}
            tone="primary"
          />
        ))}
      </Grid>

      {/* Tabela de Colaboradores */}
      <DataTable
        columns={tableColumns}
        rows={colaboradores}
        getRowId={(r) => String(r.codigoColaborador)}
        loading={loading}
        title="Desempenho por Colaborador"
        description={
          selectedPeriod
            ? `Vendas consolidadas de ${formatDate(selectedPeriod.startDate)} até ${formatDate(selectedPeriod.endDate)} (${selectedLojaLabel})`
            : undefined
        }
        emptyMessage={
          !selectedPeriod
            ? "Selecione um Período de Fechamento para carregar as vendas."
            : "Nenhuma venda encontrada para o período e filtros selecionados."
        }
        pagination={{ pageSize: 20 }}
        striped
        bordered
        frozenUntil="nomeColaborador"
        totals={colaboradoresTotals(resumo)}
        totalsCompare={colaboradoresTotalsCompare(anterior, favorableByColumn)}
        print={{
          orientation: "landscape",
          fileName: selectedPeriod ? `Desempenho de Vendas - ${selectedPeriod.name} - ${selectedLojaLabel}` : undefined,
          description: selectedPeriod
            ? `${selectedPeriod.name} · Vendas consolidadas de ${formatDate(selectedPeriod.startDate)} até ${formatDate(selectedPeriod.endDate)} (${selectedLojaLabel})`
            : undefined,
        }}
      />
    </Stack>
  );
}

/** Tela e item de menu do Plugin InovaFarma na seção Relatórios. */
export const inovafarmaWebModule = defineWebModule({
  id: "inovafarma",
  sections: [{ id: "inovafarma", label: "InovaFarma", order: 250 }],
  entries: [
    {
      id: "inovafarma-colaboradores",
      label: "Colaboradores",
      title: "Colaboradores",
      icon: Users,
      path: "/inovafarma/colaboradores",
      section: "inovafarma",
      order: 10,
      permission: "inovafarma:colaboradores:view",
      component: ColaboradoresPage,
      badge: ColaboradoresPendentesBadge,
    },
    {
      id: "inovafarma-vendas",
      label: "Desempenho de Vendas",
      title: "Desempenho de Vendas",
      icon: TrendingUp,
      path: "/inovafarma/vendas",
      section: "reports",
      order: 10,
      permission: "inovafarma:integration:view",
      component: VendasComissoesPage,
    },
  ],
});
