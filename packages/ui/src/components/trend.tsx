import * as React from "react"

import { cn } from "../lib/utils"
import { formatCurrency, formatDecimal, formatNumber, formatPercent } from "../lib/format"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

export type TrendFormat = "currency" | "decimal" | "number" | "percent"

/** Valor atual comparado a um anterior (ex.: o Período de Fechamento anterior). */
export interface Trend {
  current: number
  previous: number
  /** Rótulo do valor anterior no detalhe (ex.: nome do Período). */
  label: string
  /** `percent` compara em pontos percentuais; os demais, em variação percentual. */
  format: TrendFormat
  /** Direção boa: `up` (padrão) pinta a alta de verde, `down` de vermelho, `neutral` não pinta. */
  favorable?: "up" | "down" | "neutral"
}

const oneDecimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function formatFull(value: number, format: TrendFormat): string {
  if (format === "currency") return formatCurrency(value)
  if (format === "decimal") return formatDecimal(value)
  if (format === "percent") return formatPercent(value)
  return formatNumber(value)
}

/** Valor anterior curto, sem centavos, para caber ao lado da variação no MobileCard. */
function formatShort(value: number, format: TrendFormat): string {
  if (format === "percent") return formatPercent(value)
  return formatNumber(format === "number" ? value : Math.round(value))
}

const toneClass = {
  favorable: "text-emerald-600",
  unfavorable: "text-destructive",
  neutral: "text-muted-foreground",
} as const

/**
 * Seta, variação e tom de uma tendência; `undefined` quando não há base de comparação
 * (anterior zero em variação percentual).
 */
function describeTrend({ current, previous, format, favorable = "up" }: Trend) {
  const points = format === "percent"
  if (!points && previous === 0) return undefined
  const delta = points ? current - previous : ((current - previous) / Math.abs(previous)) * 100
  const rounded = Math.round(delta * 10) / 10
  const amount = `${oneDecimal.format(Math.abs(rounded))}${points ? " p.p." : "%"}`
  if (rounded === 0) return { text: amount, tone: toneClass.neutral }
  const up = rounded > 0
  const tone =
    favorable === "neutral" ? toneClass.neutral : up === (favorable === "up") ? toneClass.favorable : toneClass.unfavorable
  return { text: `${up ? "▲" : "▼"} ${amount}`, tone }
}

/** Detalhe da tendência no estilo do tooltip dos gráficos, aberto ao passar o mouse sobre `children`. */
function TrendTooltip({ trend, title, children }: { trend: Trend; title: string; children: React.ReactElement }) {
  const described = describeTrend(trend)
  if (!described) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      {/* Mesmo visual do `ChartTooltipContent`; esconde a seta escura do primitivo. */}
      <TooltipContent className="grid min-w-40 items-start gap-1.5 border border-border/50 bg-background text-foreground shadow-xl **:data-[side]:hidden">
        <span className="font-medium">{title}</span>
        <span className="flex justify-between gap-4">
          <span className="text-muted-foreground">Atual</span>
          <span className="font-mono font-medium tabular-nums">{formatFull(trend.current, trend.format)}</span>
        </span>
        <span className="flex justify-between gap-4">
          <span className="text-muted-foreground">{trend.label}</span>
          <span className="font-mono font-medium tabular-nums">{formatFull(trend.previous, trend.format)}</span>
        </span>
        <span className={cn("font-medium", described.tone)}>{described.text}</span>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Linha visível da tendência (ex.: "▲ 12,2%"); com `showPrevious`, acrescenta o valor anterior
 * curto (ex.: "▲ 12,2% · 11.000"). Não renderiza nada sem base de comparação.
 */
function TrendLine({ trend, showPrevious, ...props }: { trend: Trend; showPrevious?: boolean } & React.ComponentProps<"span">) {
  const described = describeTrend(trend)
  if (!described) return null
  return (
    <span {...props} className={cn("text-xs font-medium tabular-nums", described.tone, props.className)}>
      {showPrevious ? `${described.text} · ${formatShort(trend.previous, trend.format)}` : described.text}
    </span>
  )
}

export { TrendLine, TrendTooltip }
