import { useState, useEffect, useCallback } from "react";
import { TrendingUp, RefreshCw, Calendar, Store, Users, DollarSign, Award, AlertCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Button } from "@platform/ui/components/button";
import { Badge } from "@platform/ui/components/badge";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Grid, KpiCard, Spin, Stack, Text } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { defineWebModule } from "@platform/ui/contracts/module";
import { formatCurrency, formatNumber, formatDate } from "@platform/ui/lib/format";
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

interface VendedorItem {
  codigoFuncionario: number;
  nomeFuncionario: string;
  quantidadeVendas: number;
  totalBruto: number;
  totalDesconto: number;
  totalLiquido: number;
  ticketMedio: number;
  participacaoPercent: number;
}

interface ResumoVendas {
  totalVendasGeral: number;
  totalLiquidoGeral: number;
  totalBrutoGeral: number;
  totalDescontoGeral: number;
  totalVendedores: number;
}

const columns: DataTableColumn<VendedorItem>[] = [
  {
    key: "codigoFuncionario",
    label: "Cód.",
    value: (r) => r.codigoFuncionario,
    sortable: true,
    searchable: true,
    cellClassName: "font-mono text-xs w-20",
  },
  {
    key: "nomeFuncionario",
    label: "Vendedor / Colaborador",
    value: (r) => r.nomeFuncionario,
    sortable: true,
    searchable: true,
    cellClassName: "font-medium",
  },
  {
    key: "quantidadeVendas",
    label: "Qtd. Vendas",
    value: (r) => r.quantidadeVendas,
    format: "number",
    sortable: true,
    cellClassName: "text-right font-mono",
  },
  {
    key: "totalBruto",
    label: "Total Bruto",
    value: (r) => r.totalBruto,
    format: "currency",
    sortable: true,
    cellClassName: "text-right font-mono",
  },
  {
    key: "totalDesconto",
    label: "Descontos",
    value: (r) => r.totalDesconto,
    format: "currency",
    sortable: true,
    cellClassName: "text-right font-mono text-muted-foreground",
  },
  {
    key: "totalLiquido",
    label: "Total Líquido",
    value: (r) => r.totalLiquido,
    format: "currency",
    sortable: true,
    cellClassName: "text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400",
  },
  {
    key: "ticketMedio",
    label: "Ticket Médio",
    value: (r) => r.ticketMedio,
    format: "currency",
    sortable: true,
    cellClassName: "text-right font-mono",
  },
  {
    key: "participacaoPercent",
    label: "% Vendas",
    value: (r) => r.participacaoPercent,
    format: "percent",
    sortable: true,
    cellClassName: "text-right font-mono",
  },
];

function VendasComissoesPage() {
  const [periods, setPeriods] = useState<ClosingPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [selectedLoja, setSelectedLoja] = useState<string>("all");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ResumoVendas | null>(null);
  const [vendedores, setVendedores] = useState<VendedorItem[]>([]);

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

      const data = await apiFetch<{ resumo: ResumoVendas; vendedores: VendedorItem[] }>(
        `/api/m/inovafarma/relatorios/vendas-vendedor?${params.toString()}`
      );

      setResumo(data.resumo);
      setVendedores(data.vendedores || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido ao carregar relatório.");
      setVendedores([]);
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
    <Stack gap={6}>
      {/* Barra de Filtros */}
      <Stack
        direction="row"
        wrap
        align="end"
        justify="between"
        gap={4}
        padding={4}
        bordered
        surface="card"
      >
        <Stack direction="row" wrap align="end" gap={4} grow>
          {/* Seletor de Período de Fechamento */}
          <Stack gap={2} grow maxWidth="sm">
            <Stack direction="row" align="center" gap={2} iconSize="sm">
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
                  <Stack padding={2} align="center">
                    <Text variant="caption" tone="muted">
                      Nenhum período cadastrado
                    </Text>
                  </Stack>
                )}
              </SelectContent>
            </Select>
          </Stack>

          {/* Seletor de Filial / Loja */}
          <Stack gap={2} grow maxWidth="sm">
            <Stack direction="row" align="center" gap={2} iconSize="sm">
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
            <Stack direction="row" align="center" gap={2} height="control" padding={2} bordered surface="muted">
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
          label="Total Líquido"
          value={formatCurrency(resumo?.totalLiquidoGeral)}
          hint={resumo ? `${formatNumber(resumo.totalVendasGeral)} vendas realizadas` : "-"}
          icon={<DollarSign />}
          tone="success"
          highlight
        />
        <KpiCard
          label="Total Bruto"
          value={formatCurrency(resumo?.totalBrutoGeral)}
          hint={`Descontos: ${formatCurrency(resumo?.totalDescontoGeral)}`}
          icon={<TrendingUp />}
          tone="primary"
        />
        <KpiCard
          label="Ticket Médio Geral"
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
          label="Vendedores com Venda"
          value={resumo ? formatNumber(resumo.totalVendedores) : "-"}
          hint="Colaboradores ativos no período"
          icon={<Users />}
          tone="info"
        />
      </Grid>

      {/* Tabela de Vendedores */}
      <DataTable
        columns={columns}
        rows={vendedores}
        getRowId={(r) => String(r.codigoFuncionario)}
        loading={loading}
        title="Total de Vendas por Vendedor"
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
      label: "Vendas & Comissões",
      title: "Vendas & Comissões",
      icon: TrendingUp,
      path: "/inovafarma/vendas",
      group: "Relatórios",
      permission: "inovafarma:integration:view",
      component: VendasComissoesPage,
    },
  ],
});
