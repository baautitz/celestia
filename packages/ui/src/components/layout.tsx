import * as React from "react"

import { cn } from "../lib/utils"
import { Card, CardContent } from "./card"
import { Skeleton } from "./skeleton"

/**
 * Primitivos de layout e tipografia. Telas e Plugins compõem a interface
 * somente por estas props tipadas; `className`/`style` ficam restritos a `@platform/ui`
 * (ver `pnpm check:ui`).
 */

const gaps = { 0: "gap-0", 1: "gap-1", 2: "gap-2", 3: "gap-3", 4: "gap-4", 6: "gap-6", 8: "gap-8" } as const
const paddings = { 0: "p-0", 2: "p-2", 3: "p-3", 4: "p-4", 6: "p-6" } as const
const aligns = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" } as const
const justifies = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
} as const
const visibility = {
  always: "",
  desktop: "hidden lg:contents",
  mobile: "contents lg:hidden",
} as const

type Gap = keyof typeof gaps

interface StackProps extends Omit<React.ComponentProps<"div">, "className" | "style"> {
  direction?: "column" | "row"
  gap?: Gap
  align?: keyof typeof aligns
  justify?: keyof typeof justifies
  wrap?: boolean
  grow?: boolean
  shrink?: boolean
  fullWidth?: boolean
  padding?: keyof typeof paddings
  bordered?: boolean
  surface?: "card" | "muted"
  divided?: boolean
  /** Largura máxima de leitura. */
  maxWidth?: "sm" | "md"
  as?: "div" | "section" | "header" | "main"
}

function Stack({
  direction = "column",
  gap = 0,
  align,
  justify,
  wrap,
  grow,
  shrink = true,
  fullWidth,
  padding,
  bordered,
  surface,
  divided,
  maxWidth,
  as: Tag = "div",
  ...props
}: StackProps) {
  return (
    <Tag
      className={cn(
        "flex min-w-0",
        direction === "column" ? "flex-col" : "flex-row",
        gaps[gap],
        align && aligns[align],
        justify && justifies[justify],
        wrap && "flex-wrap",
        grow && "flex-1",
        !shrink && "shrink-0",
        fullWidth && "w-full",
        padding !== undefined && paddings[padding],
        bordered && "border",
        surface === "card" && "bg-card text-card-foreground",
        surface === "muted" && "bg-muted/30",
        divided && "divide-y divide-border/40",
        maxWidth === "sm" && "max-w-sm",
        maxWidth === "md" && "max-w-md"
      )}
      {...props}
    />
  )
}

interface GridProps extends Omit<React.ComponentProps<"div">, "className" | "style"> {
  /** `2` = duas colunas fixas; `cards` = 1/2/4 colunas responsivas. */
  columns: 2 | "cards"
  gap?: Gap
}

function Grid({ columns, gap = 4, ...props }: GridProps) {
  return (
    <div
      className={cn(
        "grid",
        columns === 2 ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        gaps[gap]
      )}
      {...props}
    />
  )
}

/** Exibe o conteúdo apenas em desktop ou apenas em mobile, sem afetar o layout do pai. */
function Show({ on, ...props }: Omit<React.ComponentProps<"div">, "className" | "style"> & { on: "desktop" | "mobile" }) {
  return <div className={visibility[on]} {...props} />
}

const textVariants = {
  body: "",
  small: "text-sm",
  caption: "text-xs",
  tiny: "text-[11px]",
  mono: "font-mono text-xs",
  title: "text-2xl font-bold tracking-tight",
  eyebrow: "text-xs font-bold uppercase tracking-wider",
  kpi: "text-2xl font-bold font-mono",
} as const

const tones = {
  default: "",
  muted: "text-muted-foreground",
  destructive: "text-destructive",
  success: "text-emerald-600",
  warning: "text-amber-600",
} as const

interface TextProps extends Omit<React.ComponentProps<"span">, "className" | "style"> {
  as?: "span" | "p" | "h1" | "h2" | "strong"
  variant?: keyof typeof textVariants
  tone?: keyof typeof tones
  weight?: "medium" | "semibold" | "bold"
  truncate?: boolean
  breakAll?: boolean
}

function Text({ as: tag = "span", variant = "body", tone = "default", weight, truncate, breakAll, ...props }: TextProps) {
  const Tag = tag as "span"
  return (
    <Tag
      className={cn(
        textVariants[variant],
        tones[tone],
        weight === "medium" && "font-medium",
        weight === "semibold" && "font-semibold",
        weight === "bold" && "font-bold",
        truncate && "truncate",
        breakAll && "break-all"
      )}
      {...props}
    />
  )
}

/** Gira o ícone filho enquanto `active`. */
function Spin({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <span className={cn("inline-flex", active && "animate-spin")}>{children}</span>
}

const kpiTones = {
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-600",
  warning: "bg-amber-500/10 text-amber-600",
  info: "bg-sky-500/10 text-sky-600",
} as const

/** Ícone circular colorido usado em cartões de indicador. */
function IconBadge({ tone = "primary", children }: { tone?: keyof typeof kpiTones; children: React.ReactNode }) {
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", kpiTones[tone])}>
      {children}
    </span>
  )
}

/** Cartão de indicador (KPI) com ícone. */
function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
  highlight,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon: React.ReactNode
  tone?: keyof typeof kpiTones
  highlight?: boolean
}) {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" align="center" justify="between" gap={4}>
          <Stack gap={1}>
            <Text variant="caption" tone="muted" weight="medium">
              {label}
            </Text>
            <Text variant="kpi" tone={highlight ? "success" : "default"}>
              {value}
            </Text>
            {hint && (
              <Text variant="caption" tone="muted">
                {hint}
              </Text>
            )}
          </Stack>
          <IconBadge tone={tone}>{icon}</IconBadge>
        </Stack>
      </CardContent>
    </Card>
  )
}

/** Marca quadrada da plataforma (sidebar). */
function BrandMark({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex aspect-square size-8 items-center justify-center rounded-none bg-primary text-primary-foreground">
      {children}
    </span>
  )
}

/** Barra superior fixa da área autenticada. */
function AppHeader(props: Omit<React.ComponentProps<"header">, "className" | "style">) {
  return (
    <header
      className="sticky top-0 z-50 flex h-14 shrink-0 items-center border-b border-border/50 bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/60 md:px-6"
      {...props}
    />
  )
}

/** Área de conteúdo das páginas autenticadas. */
function AppMain(props: Omit<React.ComponentProps<"main">, "className" | "style">) {
  return <main className="flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8" {...props} />
}

/** Tela central (login, carregamento, acesso negado). */
function CenteredScreen({ children, fullHeight = true }: { children: React.ReactNode; fullHeight?: boolean }) {
  return (
    <main className={cn("flex items-center justify-center p-4", fullHeight ? "min-h-screen bg-muted/20" : "p-12")}>
      {fullHeight ? <div className="w-full max-w-md">{children}</div> : children}
    </main>
  )
}

/** Tela de carregamento da área autenticada. */
function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    </main>
  )
}

/** Título e descrição de uma página. */
function PageHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div>
      <Text as="h1" variant="title">
        {title}
      </Text>
      {description && (
        <Text as="p" variant="small" tone="muted">
          {description}
        </Text>
      )}
    </div>
  )
}

export { Stack, Grid, Show, Text, Spin, IconBadge, KpiCard, BrandMark, AppHeader, AppMain, CenteredScreen, LoadingScreen, PageHeader }
