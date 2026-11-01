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
  /** `id` de uma Seção do Menu declarada por algum módulo. */
  section: string
  /** Posição dentro da Seção (crescente); ausente = depois de todas que declaram. Empate: ordem de registro. */
  order?: number
  permission: string
  /** Título do breadcrumb; padrão: `label`. */
  title?: string
  /** Tela padrão, usada quando o User tem `permission` e nenhuma variante casa. */
  component: ComponentType
  /** Indicador opcional ao lado do item do menu, como uma contagem de pendências. */
  badge?: ComponentType
  /** Variantes de tela por Permission; a primeira que casa (ordem de declaração) vence. */
  variants?: NavVariant[]
}

export interface MenuSection {
  id: string
  label: string
  /** Posição no menu (crescente); ausente = depois de todas que declaram. Empate: ordem de registro. */
  order?: number
}

export interface WebModule {
  id: string
  /** Módulos de que este depende (como no `defineModule` do servidor): só eles podem ser chamados por `useWebService`. */
  dependsOn?: string[]
  /** Serviços oferecidos a outros módulos, por nome; obtidos com `useWebService(id, nome)`. */
  services?: Record<string, unknown>
  /** Seções do Menu declaradas pelo módulo; o `id` é único entre todos os módulos. */
  sections?: MenuSection[]
  entries: NavEntry[]
}

export const defineWebModule = (module: WebModule): WebModule => module
