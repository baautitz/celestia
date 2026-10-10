import React, { useEffect, useMemo, useState } from "react";
import type { ChartProps, ChartDataResponse } from "@platform/shared";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { api } from "@/lib/api-client";
import { useImperativeUI } from "@/context/ImperativeUIContext";
import { formatCompactNumber, formatCurrency, formatDate, formatShortDate } from "@/lib/utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Pie,
  PieChart,
  Line,
  LineChart,
  LabelList,
} from "recharts";
import { QueryProfileSelect } from "./QueryProfileSelect";
import { useQueryProfileSelection } from "@/hooks/use-query-profile-selection";

interface SDUIChartProps {
  id: string;
  component: "bar_chart" | "line_chart" | "pie_chart";
  props: ChartProps;
  workspaceId: string;
  recipeId: string;
  startDate: string;
  endDate: string;
  /** Parâmetros do Dashboard usados quando não há Área de Trabalho (modo prévia). */
  params?: Record<string, unknown>;
}

export const SDUIChart: React.FC<SDUIChartProps> = React.memo(({
  id,
  component,
  props,
  workspaceId,
  recipeId,
  startDate,
  endDate,
  params,
}) => {
  const [data, setData] = useState<ChartDataResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useQueryProfileSelection({
    recipeId,
    workspaceId,
    componentId: id,
    profiles: props.availableProfiles,
  });
  const { refreshSignal } = useImperativeUI();

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    api.workspaces
      .getData(workspaceId, id, {
        recipe_id: recipeId,
        start_date: startDate,
        end_date: endDate,
        params,
        profile_id: profileId,
      })
      .then((res) => {
        if (isMounted && res.type === "chart") {
          setData(res as ChartDataResponse);
        } else if (isMounted) {
          setError("Resposta inesperada do servidor.");
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          setError(
            err instanceof Error ? err.message : "Erro ao carregar dados do gráfico."
          );
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id, workspaceId, recipeId, startDate, endDate, params, profileId, refreshSignal]);

  const chartData = data?.data ?? [];

  const barConfig = useMemo<ChartConfig>(
    () => ({
      value: {
        label: "Vendas",
        color: "var(--chart-1)",
      },
    }),
    []
  );

  const pieConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    chartData.forEach((item, idx) => {
      const key = String(item.name ?? `item-${idx}`);
      cfg[key] = {
        label: key,
        color: `var(--chart-${(idx % 5) + 1})`,
      };
    });
    return cfg;
  }, [chartData]);

  const lineConfig = barConfig;

  // Gráfico com séries (ex.: uma linha por vendedor): cada série tem uma cor; passando de 5, as linhas ficam tracejadas.
  const series = data?.series ?? [];
  const seriesConfig = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        series.map((item, index) => [item.key, { label: item.label, color: `var(--chart-${(index % 5) + 1})` }])
      ),
    [series]
  );

  const pieData = useMemo(
    () =>
      chartData.map((item, idx) => ({
        name: String(item.name ?? ""),
        value: Number(item.value ?? 0),
        fill: `var(--chart-${(idx % 5) + 1})`,
      })),
    [chartData]
  );

  const renderContent = () => {
    if (loading) return <Skeleton className="h-full min-h-[180px] md:min-h-[220px] w-full" />;

    if (error) {
      return (
        <div className="flex h-full min-h-[180px] md:min-h-[220px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      );
    }

    if (chartData.length === 0) {
      return (
        <div className="flex h-full min-h-[180px] md:min-h-[220px] w-full items-center justify-center text-sm text-muted-foreground">
          Nenhum dado para exibir.
        </div>
      );
    }

    if (component === "bar_chart" && props.orientation === "horizontal") {
      return (
        <ChartContainer config={barConfig} className="h-full w-full min-h-[180px] md:min-h-[220px]">
          <BarChart
            accessibilityLayer
            data={chartData}
            layout="vertical"
            margin={{ left: 0, right: 24, top: 4, bottom: 4 }}
          >
            <CartesianGrid horizontal={false} />
            <YAxis
              dataKey="name"
              type="category"
              tickLine={false}
              tickMargin={8}
              axisLine={false}
              interval={0}
              width={170}
              tick={{ fontSize: 12 }}
              tickFormatter={(v: string) => {
                // "NATALIA MARIA IRALA SOUZA" -> "NATALIA SOUZA"; o nome completo aparece no tooltip.
                const parts = String(v).split(" ");
                const s = parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : String(v);
                return s.length > 22 ? `${s.slice(0, 21)}…` : s;
              }}
            />
            <XAxis
              type="number"
              // Folga de 25% depois da maior barra para o rótulo de valor não ser cortado.
              domain={[0, (dataMax: number) => dataMax * 1.25]}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatCurrency(v)}
              tick={{ fontSize: 11 }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelKey="name"
                  indicator="dot"
                  formatter={(value) => formatCurrency(value as number)}
                />
              }
            />
            <Bar dataKey="value" fill="var(--color-value)" radius={4}>
              <LabelList
                position="right"
                offset={8}
                className="fill-foreground"
                fontSize={11}
                formatter={(v: number) => formatCurrency(v)}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      );
    }

    if (component === "bar_chart") {
      return (
        <ChartContainer config={barConfig} className="h-full w-full min-h-[180px] md:min-h-[220px]">
          <BarChart
            accessibilityLayer
            data={chartData}
            margin={{ left: 12, right: 12, top: 24, bottom: 4 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="name"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              interval={0}
              tick={{ fontSize: 11 }}
              tickFormatter={(v: string) => {
                const s = String(v);
                return s.length > 10 ? `${s.slice(0, 9)}…` : s;
              }}
            />
            <YAxis hide tickLine={false} axisLine={false} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelKey="name"
                  indicator="dot"
                  formatter={(value) => formatCurrency(value as number)}
                />
              }
            />
            <Bar dataKey="value" fill="var(--color-value)" radius={4}>
              <LabelList
                position="top"
                offset={8}
                className="fill-foreground"
                fontSize={10}
                formatter={(v: number) => formatCurrency(v)}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      );
    }

    if (component === "line_chart" && series.length > 0) {
      return (
        <ChartContainer config={seriesConfig} className="h-full w-full min-h-[240px] md:min-h-[300px]">
          <LineChart accessibilityLayer data={chartData} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              tick={{ fontSize: 11 }}
              tickFormatter={(value: string) => formatShortDate(String(value))}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={48}
              tick={{ fontSize: 11 }}
              tickFormatter={(value: number) => formatCompactNumber(value)}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator="line" labelFormatter={(label) => formatDate(String(label))} />}
            />
            <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
            {series.map((item, index) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                stroke={`var(--color-${item.key})`}
                strokeWidth={2}
                strokeDasharray={index >= 5 ? "5 4" : undefined}
                dot={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      );
    }

    if (component === "line_chart") {
      return (
        <ChartContainer config={lineConfig} className="h-full w-full min-h-[180px] md:min-h-[220px]">
          <LineChart
            accessibilityLayer
            data={chartData}
            margin={{ left: 12, right: 12 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="name"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tick={{ fontSize: 12 }}
            />
            <YAxis hide tickLine={false} axisLine={false} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelKey="name"
                  indicator="line"
                  formatter={(value) => formatCurrency(value as number)}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={{ r: 4 }}
            />
          </LineChart>
        </ChartContainer>
      );
    }

    // pie_chart
    return (
      <ChartContainer
        config={pieConfig}
        className="h-full w-full min-h-[180px] md:min-h-[220px] flex items-center justify-center"
      >
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelKey="name"
                indicator="dot"
                nameKey="name"
                formatter={(value) => formatCurrency(value as number)}
              />
            }
          />
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            strokeWidth={2}
            stroke="hsl(var(--background))"
          />
          <ChartLegend
            content={<ChartLegendContent nameKey="name" />}
            verticalAlign="bottom"
          />
        </PieChart>
      </ChartContainer>
    );
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2 shrink-0">
        <div>
          <CardTitle className="text-sm font-medium">
            {props.title ?? "Gráfico"}
          </CardTitle>
          {chartData.length > 0 && !loading && !error && (
            <CardDescription>
              {component === "bar_chart"
                ? `Ranking por vendas — ${chartData.length} vendedor(es)`
                : component === "pie_chart"
                  ? `Distribuição entre ${chartData.length} vendedor(es)`
                  : `${chartData.length} ponto(s) de dados`}
            </CardDescription>
          )}
        </div>
        <QueryProfileSelect
          profiles={props.availableProfiles}
          value={profileId}
          onValueChange={setProfileId}
        />
      </CardHeader>
      <CardContent className="flex-1 min-h-0 pb-3">{renderContent()}</CardContent>
    </Card>
  );
});
