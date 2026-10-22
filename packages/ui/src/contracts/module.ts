import type { ComponentType } from "react"
import type { LucideIcon } from "lucide-react"

export interface NavVariant {
  permission: string
  component: ComponentType
}

export interface NavEntry {
  id: string
  label: string
  icon: LucideIcon
  /** Rota do menu e da página (ex.: "/iam/users"). */
  path: string
  /** Rótulo do grupo do menu; entradas do mesmo grupo ficam juntas, na ordem de registro. */
  group: string
  permission: string
  /** Título do breadcrumb; padrão: `label`. */
  title?: string
  /** Tela padrão, usada quando o User tem `permission` e nenhuma variante casa. */
  component: ComponentType
  /** Variantes de tela por Permission; a primeira que casa (ordem de declaração) vence. */
  variants?: NavVariant[]
}

export interface WebModule {
  id: string
  entries: NavEntry[]
}

export const defineWebModule = (module: WebModule): WebModule => module
