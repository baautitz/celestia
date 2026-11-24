import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./chart"

export interface SeriesChartSerie {
  /** Chave do valor em cada linha de `data`. */
  key: string
  label: string
}

export interface SeriesChartProps {
  /** Uma linha por posição do eixo X; os valores das séries são números. */
  data: readonly Record<string, string | number>[]
  /** Chave do rótulo do eixo X em cada linha. */
  xKey: string
  series: readonly SeriesChartSerie[]
  kind?: "bar" | "line"
  /** Empilha as barras (só `kind="bar"`). */
  stacked?: boolean
  /** Formata os valores do eixo Y. */
  formatValue?: (valor: number) => string
}

const PALETA = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]
const corDa = (i: number) => PALETA[i % PALETA.length] ?? "var(--chart-1)"

/** Gráfico de barras ou linhas, com as séries nas cores do tema, legenda e dica ao passar o mouse. */
export function SeriesChart({ data, xKey, series, kind = "bar", stacked = false, formatValue }: SeriesChartProps) {
  const config: ChartConfig = Object.fromEntries(series.map((s, i) => [s.key, { label: s.label, color: corDa(i) }]))
  const eixos = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} />
      <YAxis tickLine={false} axisLine={false} width="auto" tickFormatter={formatValue} />
      <ChartTooltip content={<ChartTooltipContent />} />
      {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
    </>
  )
  return (
    <ChartContainer config={config} className="h-[200px] w-full">
      {kind === "line" ? (
        <LineChart data={[...data]}>
          {eixos}
          {series.map((s) => (
            <Line key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`} strokeWidth={2} dot={{ r: 3 }} connectNulls />
          ))}
        </LineChart>
      ) : (
        <BarChart data={[...data]}>
          {eixos}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={stacked ? 0 : 3} stackId={stacked ? "a" : undefined} />
          ))}
        </BarChart>
      )}
    </ChartContainer>
  )
}
