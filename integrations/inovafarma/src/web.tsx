import { useState, useEffect, useCallback } from "react";
import { TrendingUp, RefreshCw, Calendar, Store, Users, DollarSign, Award, AlertCircle, Package, Pill } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Button } from "@platform/ui/components/button";
import { Badge } from "@platform/ui/components/badge";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Grid, KpiCard, Spin, Stack, Text } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { defineWebModule } from "@platform/ui/contracts/module";
import { formatCurrency, formatDecimal, formatNumber, formatDate, formatPercent } from "@platform/ui/lib/format";
import { apiFetch } from "@platform/ui/lib/api";

interface ClosingPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "open" | "closed" | "cancelled";
}

interface Loja {
  codigoEmpresa: number;
  nome: string;
}

type Categoria = "vitaminas" | "genericos" | "similares" | "incentivos";
type CategoriaTotais = Record<Categoria, { quantidade: number; valor: number }>;

/** Categorias de produto exibidas com Qtde e Valor; os IDs ficam fixos no servidor do Plugin. */
const CATEGORIAS: { key: Categoria; label: string; tooltip: string }[] = [
  { key: "vitaminas", label: "Vitaminas", tooltip: "Itens do grupo de produto VITAMINAS (44)." },
  { key: "genericos", label: "Genéricos", tooltip: "Itens da seção de produto GENERICOS (261)." },
  { key: "similares", label: "Similares", tooltip: "Itens da seção de produto SIMILARES (271)." },
  { key: "incentivos", label: "Incentivos", tooltip: "Itens da seção de produto INCENTIVOS (281)." },
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

function VendasComissoesPage() {
  const [periods, setPeriods] = useState<ClosingPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [selectedLoja, setSelectedLoja] = useState<string>("all");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ResumoVendas | null>(null);
  const [colaboradores, setColaboradores] = useState<ColaboradorItem[]>([]);

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
      const params = new URLSearchParams({
        dataInicio: selectedPeriod.startDate,
        dataFim: selectedPeriod.endDate,
      });
      if (selectedLoja !== "all") {
        params.append("codigoEmpresa", selectedLoja);
      }

      const data = await apiFetch<{ resumo: ResumoVendas; colaboradores: ColaboradorItem[] }>(
        `/api/m/inovafarma/relatorios/vendas-colaborador?${params.toString()}`
      );

      setResumo(data.resumo);
      setColaboradores(data.colaboradores || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido ao carregar relatório.");
      setColaboradores([]);
      setResumo(null);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, selectedLoja]);

  useEffect(() => {
    if (selectedPeriodId) {
      void fetchRelatorio();
    }
  }, [selectedPeriodId, selectedLoja, fetchRelatorio]);

  const selectedLojaLabel =
    selectedLoja === "all"
      ? "Todas as Filiais"
      : lojas.find((l) => String(l.codigoEmpresa) === selectedLoja)?.nome || `Filial ${selectedLoja}`;

  const selectedPeriodLabel = selectedPeriod
    ? `${selectedPeriod.name} (${formatDate(selectedPeriod.startDate)} a ${formatDate(selectedPeriod.endDate)})`
    : "Selecione um Período";

  return (
    <Stack gap="section">
      {/* Barra de Filtros */}
      <Stack
        direction="row"
        wrap
        align="end"
        justify="between"
        gap="section"
        padding="card"
        bordered
        surface="card"
      >
        <Stack direction="row" wrap align="end" gap="section" grow>
          {/* Seletor de Período de Fechamento */}
          <Stack gap="field" grow maxWidth="sm">
            <Stack direction="row" align="center" gap="field" iconSize="sm">
              <Calendar />
              <Text variant="caption" tone="muted" weight="medium">
                Período de Fechamento
              </Text>
            </Stack>
            <Select value={selectedPeriodId} onValueChange={(val) => val && setSelectedPeriodId(val)}>
              <SelectTrigger fullWidth>
                <SelectValue placeholder="Selecione um período">{selectedPeriodLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({formatDate(p.startDate)} a {formatDate(p.endDate)})
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
          </Stack>

          {/* Seletor de Filial / Loja */}
          <Stack gap="field" grow maxWidth="sm">
            <Stack direction="row" align="center" gap="field" iconSize="sm">
              <Store />
              <Text variant="caption" tone="muted" weight="medium">
                Filial / Loja
              </Text>
            </Stack>
            <Select value={selectedLoja} onValueChange={(val) => val && setSelectedLoja(val)}>
              <SelectTrigger fullWidth>
                <SelectValue placeholder="Todas as Filiais">{selectedLojaLabel}</SelectValue>
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
          </Stack>

          {selectedPeriod && (
            <Stack direction="row" align="center" gap="field" height="control" padding="compact" bordered surface="muted">
              <Text variant="caption" tone="muted">
                Status:
              </Text>
              <Badge variant={selectedPeriod.status === "open" ? "secondary" : "outline"}>
                {selectedPeriod.status === "open" ? "Aberto" : selectedPeriod.status === "closed" ? "Fechado" : "Cancelado"}
              </Badge>
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
          value={resumo ? formatNumber(resumo.totalVendasGeral) : "-"}
          hint={resumo ? `${formatNumber(resumo.totalColaboradores)} colaboradores com venda` : "-"}
          icon={<Users />}
          tone="info"
        />
        <KpiCard
          loading={loading}
          label="Total Bruto"
          value={formatCurrency(resumo?.totalBrutoGeral)}
          icon={<TrendingUp />}
          tone="primary"
        />
        <KpiCard
          loading={loading}
          label="Descontos"
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
          value={formatCurrency(resumo?.totalLiquidoGeral)}
          icon={<DollarSign />}
          tone="success"
        />
        <KpiCard
          loading={loading}
          label="CMV (R$)"
          value={formatCurrency(resumo?.totalCmvGeral)}
          icon={<Package />}
          tone="primary"
        />
        <KpiCard
          loading={loading}
          label="CMV (%)"
          value={resumo ? formatPercent(resumo.cmvPercentGeral) : "-"}
          hint="do Total Líquido"
          icon={<Package />}
          tone="primary"
        />
        <KpiCard
          loading={loading}
          label="Ticket Médio"
          value={
            resumo && resumo.totalVendasGeral > 0
              ? formatCurrency(resumo.totalLiquidoGeral / resumo.totalVendasGeral)
              : "R$ 0,00"
          }
          hint="Média por cupom de venda"
          icon={<Award />}
          tone="warning"
        />
        <KpiCard
          loading={loading}
          label="Cadastros (%)"
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
            value={formatCurrency(resumo?.categorias[key].valor)}
            hint={resumo ? `${formatNumber(resumo.categorias[key].quantidade)} un` : "-"}
            icon={<Pill />}
            tone="primary"
          />
        ))}
      </Grid>

      {/* Tabela de Colaboradores */}
      <DataTable
        columns={columns}
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
        frozenUntil="nomeColaborador"
        print={{
          orientation: "landscape",
          fileName: selectedPeriod ? `Desempenho de Vendas - ${selectedPeriod.name} - ${selectedLojaLabel}` : undefined,
        }}
      />
    </Stack>
  );
}

/** Tela e item de menu do Plugin InovaFarma na seção Relatórios. */
export const inovafarmaWebModule = defineWebModule({
  id: "inovafarma",
  entries: [
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
