import { useState, useEffect, useCallback } from "react";
import { TrendingUp, RefreshCw, Calendar, Store, Users, DollarSign, Award, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@platform/ui/components/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Button } from "@platform/ui/components/button";
import { Badge } from "@platform/ui/components/badge";
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
    <div className="flex flex-col gap-6">
      {/* Barra de Filtros */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 p-4 border bg-card text-card-foreground shadow-xs">
        <div className="flex flex-wrap items-end gap-4 flex-1">
          {/* Seletor de Período de Fechamento */}
          <div className="flex flex-col gap-1.5 min-w-[280px] flex-1 max-w-sm">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              Período de Fechamento
            </span>
            <Select value={selectedPeriodId} onValueChange={(val) => val && setSelectedPeriodId(val)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione um período">{selectedPeriodLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({formatDate(p.startDate)} a {formatDate(p.endDate)})
                  </SelectItem>
                ))}
                {periods.length === 0 && (
                  <div className="p-2 text-xs text-muted-foreground text-center">Nenhum período cadastrado</div>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Seletor de Filial / Loja */}
          <div className="flex flex-col gap-1.5 min-w-[220px] flex-1 max-w-xs">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Store className="size-3.5" />
              Filial / Loja
            </span>
            <Select value={selectedLoja} onValueChange={(val) => val && setSelectedLoja(val)}>
              <SelectTrigger className="w-full">
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
          </div>

          {selectedPeriod && (
            <div className="flex items-center h-8 px-2.5 border text-xs bg-muted/30">
              <span className="text-muted-foreground mr-1.5">Status:</span>
              <Badge variant={selectedPeriod.status === "open" ? "secondary" : "outline"} className="text-xs">
                {selectedPeriod.status === "open" ? "Aberto" : selectedPeriod.status === "closed" ? "Fechado" : "Cancelado"}
              </Badge>
            </div>
          )}
        </div>

        <Button
          variant="outline"
          size="default"
          onClick={() => void fetchRelatorio()}
          disabled={loading || !selectedPeriod}
          className="gap-2 shrink-0"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Alerta se não houver períodos */}
      {periods.length === 0 && !loading && (
        <div className="p-4 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0 text-amber-600" />
            <span>Nenhum Período de Fechamento cadastrado na plataforma.</span>
          </div>
          <a href="/closing-periods" className="text-xs font-medium underline underline-offset-4 hover:opacity-80">
            Cadastrar Período
          </a>
        </div>
      )}

      {/* Erro de conexão ou consulta */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="size-5 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <span className="font-semibold">Falha na consulta InovaFarma:</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Cards de Resumo / KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Líquido</p>
              <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                {formatCurrency(resumo?.totalLiquidoGeral)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {resumo ? `${formatNumber(resumo.totalVendasGeral)} vendas realizadas` : "-"}
              </p>
            </div>
            <div className="size-11 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <DollarSign className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Bruto</p>
              <p className="text-2xl font-bold font-mono mt-1">{formatCurrency(resumo?.totalBrutoGeral)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Descontos: {formatCurrency(resumo?.totalDescontoGeral)}
              </p>
            </div>
            <div className="size-11 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <TrendingUp className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Ticket Médio Geral</p>
              <p className="text-2xl font-bold font-mono mt-1">
                {resumo && resumo.totalVendasGeral > 0
                  ? formatCurrency(resumo.totalLiquidoGeral / resumo.totalVendasGeral)
                  : "R$ 0,00"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Média por cupom de venda</p>
            </div>
            <div className="size-11 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Award className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Vendedores com Venda</p>
              <p className="text-2xl font-bold font-mono mt-1">
                {resumo ? formatNumber(resumo.totalVendedores) : "-"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Colaboradores ativos no período</p>
            </div>
            <div className="size-11 rounded-full bg-sky-500/10 flex items-center justify-center text-sky-600 dark:text-sky-400">
              <Users className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

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
    </div>
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
