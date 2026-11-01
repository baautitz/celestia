import { createContext, createElement, useContext, type ReactNode } from "react"
import type { WebModule } from "./module.ts"

/** Serviços dos módulos web por `<módulo>:<nome>`. */
export type WebServices = ReadonlyMap<string, unknown>

const chave = (moduleId: string, name: string) => `${moduleId}:${name}`

/** Junta os serviços dos módulos; lança se um módulo depender de outro que não está registrado antes dele. */
export function buildWebServices(modules: WebModule[]): WebServices {
  const services = new Map<string, unknown>()
  const registrados = new Set<string>()
  for (const m of modules) {
    for (const dep of m.dependsOn ?? []) {
      if (!registrados.has(dep)) throw new Error(`Módulo web "${m.id}" depende de "${dep}", que não está registrado antes dele`)
    }
    for (const [name, service] of Object.entries(m.services ?? {})) services.set(chave(m.id, name), service)
    registrados.add(m.id)
  }
  return services
}

const WebServicesContext = createContext<WebServices>(new Map())

export function WebServicesProvider({ services, children }: { services: WebServices; children: ReactNode }) {
  return createElement(WebServicesContext.Provider, { value: services }, children)
}

/** Serviço `name` do módulo `moduleId`; o formato vem do módulo que o oferece. */
export function useWebService<T>(moduleId: string, name: string): T {
  const service = useContext(WebServicesContext).get(chave(moduleId, name))
  if (service === undefined) throw new Error(`Serviço web "${chave(moduleId, name)}" não registrado`)
  return service as T
}
