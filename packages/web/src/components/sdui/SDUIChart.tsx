import React, { useEffect, useMemo, useState } from "react";
import type { ChartProps, ChartDataResponse } from "@platform/shared";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { api } from "@/lib/api-client";
import { useImperativeUI } from "@/context/ImperativeUIContext";
import { formatCurrency } from "@/lib/utils";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Pie, PieChart, Line, LineChart, LabelList } from "recharts";

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
          setError(err instanceof Error ? err.message : "Erro ao carregar dados do gráfico.");
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

  const barConfig = useMemo<ChartConfig>(() => {
    return {
      value: {
        label: props.title ?? "Valor",
        color: "var(--chart-1)",
      },
    } satisfies ChartConfig;
  }, [props.title]);

  const pieConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    chartData.forEach((item, idx) => {
      const key = String(item.name ?? `item-${idx}`);
      cfg[key] = {
        label: key,
        color: `var(--chart-${(idx % 5) + 1})`,
      };
    });
    // fallback se vazio
    if (Object.keys(cfg).length === 0) {
      cfg["value"] = { label: "Valor", color: "var(--chart-1)" };
    }
    return cfg;
  }, [chartData]);

  const lineConfig = barConfig;

  const pieDataWithFill = useMemo(() => {
    return chartData.map((item) => ({
      ...item,
      fill: `var(--color-${String(item.name)})`,
      // ensure name is string for recharts
      name: String(item.name ?? ""),
      value: Number(item.value ?? 0),
    }));
  }, [chartData]);

  const renderContent = () => {
    if (loading) {
      return <Skeleton className="h-[250px] w-full" />;
    }

    if (error) {
      return (
        <div className="flex h-[250px] w-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      );
    }

    if (chartData.length === 0) {
      return (
        <div className="flex h-[250px] w-full items-center justify-center text-sm text-muted-foreground">
          Nenhum dado para exibir.
        </div>
      );
    }

    if (component === "bar_chart") {
      return (
        <ChartContainer config={barConfig} className="min-h-[250px] w-full">
          <BarChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="name"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tickFormatter={(value: string) => String(value).slice(0, 12)}
            />
            <YAxis hide tickLine={false} axisLine={false} />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel formatter={(value) => formatCurrency(value as number)} />}
            />
            <Bar dataKey="value" fill="var(--color-value)" radius={8}>
              <LabelList position="top" offset={8} className="fill-foreground" fontSize={12} />
            </Bar>
          </BarChart>
        </ChartContainer>
      );
    }

    if (component === "line_chart") {
      return (
        <ChartContainer config={lineConfig} className="min-h-[250px] w-full">
          <LineChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="name" tickLine={false} tickMargin={10} axisLine={false} />
            <YAxis hide tickLine={false} axisLine={false} />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel formatter={(value) => formatCurrency(value as number)} />}
            />
            <Line type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ChartContainer>
      );
    }

    // pie_chart
    return (
      <ChartContainer config={pieConfig} className="mx-auto aspect-square max-h-[250px] w-full">
        <PieChart>
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel formatter={(value) => formatCurrency(value as number)} />} />
          <Pie data={pieDataWithFill} dataKey="value" nameKey="name" />
        </PieChart>
      </ChartContainer>
    );
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{props.title ?? "Gráfico"}</CardTitle>
        {chartData.length > 0 && !loading && !error && (
          <CardDescription>
            {component === "bar_chart"
              ? `Top ${chartData.length} registros`
              : component === "pie_chart"
                ? `${chartData.length} categorias`
                : `${chartData.length} pontos`}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex-1 pb-0">{renderContent()}</CardContent>
    </Card>
  );
};
