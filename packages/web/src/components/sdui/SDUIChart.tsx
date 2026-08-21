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
import { formatCurrency } from "@/lib/utils";
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

interface SDUIChartProps {
  id: string;
  component: "bar_chart" | "line_chart" | "pie_chart";
  props: ChartProps;
  workspaceId: string;
  recipeId: string;
  startDate: string;
  endDate: string;
}

export const SDUIChart: React.FC<SDUIChartProps> = ({
  id,
  component,
  props,
  workspaceId,
  recipeId,
  startDate,
  endDate,
}) => {
  const [data, setData] = useState<ChartDataResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
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
  }, [id, workspaceId, recipeId, startDate, endDate, refreshSignal]);

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
    if (loading) return <Skeleton className="h-[280px] w-full" />;

    if (error) {
      return (
        <div className="flex h-[280px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      );
    }

    if (chartData.length === 0) {
      return (
        <div className="flex h-[280px] w-full items-center justify-center text-sm text-muted-foreground">
          Nenhum dado para exibir.
        </div>
      );
    }

    if (component === "bar_chart") {
      const barHeight = Math.max(200, chartData.length * 40 + 40);
      return (
        <div className="w-full" style={{ height: barHeight }}>
          <ChartContainer config={barConfig} className="h-full w-full">
            <BarChart
              accessibilityLayer
              data={chartData}
              layout="vertical"
              margin={{ left: 10, right: 20, top: 4, bottom: 4 }}
            >
              <CartesianGrid horizontal={false} />
              <YAxis
                dataKey="name"
                type="category"
                tickLine={false}
                tickMargin={8}
                axisLine={false}
                width={130}
                tick={{ fontSize: 12 }}
              />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => formatCurrency(v)}
                tick={{ fontSize: 11 }}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideLabel
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
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
      );
    }

    if (component === "line_chart") {
      return (
        <ChartContainer config={lineConfig} className="min-h-[250px] w-full">
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
                  hideLabel
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
      <div className="flex flex-col items-center gap-2">
        <ChartContainer
          config={pieConfig}
          className="mx-auto aspect-square max-h-[220px] w-full"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
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
      </div>
    );
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
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
      </CardHeader>
      <CardContent className="flex-1 pb-3">{renderContent()}</CardContent>
    </Card>
  );
};
