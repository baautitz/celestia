import { createContext, useContext } from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import { Button } from "../components/button.tsx"
import type { CloseReason } from "../contracts/windows.ts"

export interface WindowHandle<TResult = unknown> {
  resolve: (value: TResult) => void
  dismiss: (reason?: CloseReason) => void
  /** Consultado só ao tentar fechar; `null` remove. */
  setDirtyCheck: (check: (() => boolean) | null) => void
  /** Substitui o título da janela enquanto ela estiver aberta. */
  setTitle: (title: ReactNode) => void
}

export const WindowContext = createContext<WindowHandle | null>(null)
/** Elemento do footer da janela; recebe as ações via portal. */
export const WindowFooterContext = createContext<HTMLElement | null>(null)

export function useWindow<TResult = unknown>(): WindowHandle<TResult> {
  const handle = useContext(WindowContext)
  if (!handle) throw new Error("useWindow() deve ser usado dentro de uma janela aberta por useUi().")
  return handle as WindowHandle<TResult>
}

export function WindowActions({ children }: { children: ReactNode }) {
  const slot = useContext(WindowFooterContext)
  return slot ? createPortal(children, slot) : null
}

export function WindowCancelButton({ children = "Cancelar" }: { children?: ReactNode }) {
  const { dismiss } = useWindow()
  return (
    <Button type="button" variant="outline" onClick={() => dismiss("cancel")}>
      {children}
    </Button>
  )
}
