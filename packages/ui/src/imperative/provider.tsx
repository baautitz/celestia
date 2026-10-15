import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { AlertDialogAction, AlertDialogCancel } from "../components/alert-dialog.tsx"
import { feedbackService } from "../adapters/feedback-toast.ts"
import type { FeedbackService, NavigationService, Ui } from "../contracts/services.ts"
import type { ConfirmOptions, FocusTarget, OpenWindowOptions } from "../contracts/windows.ts"
import { WindowController } from "./controller.ts"
import { WindowHost } from "./host.tsx"
import type { WindowContent } from "./host.tsx"
import { WindowActions, useWindow } from "./use-window.tsx"

const UiContext = createContext<Ui<WindowContent> | null>(null)

export function useUi(): Ui<WindowContent> {
  const ui = useContext(UiContext)
  if (!ui) throw new Error("useUi() deve ser usado dentro de <UiProvider>.")
  return ui
}

function activeElement(): FocusTarget | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function restoreFocus(target: FocusTarget | null, windowChanged: () => boolean): void {
  if (!(target instanceof HTMLElement) || !target.isConnected) return
  const blocked = () => target.closest("[inert]") !== null
  if (typeof window === "undefined") {
    if (!blocked()) target.focus()
    return
  }
  requestAnimationFrame(() => {
    // janela aberta em cadeia após o fechamento: não roubar o foco dela
    if (target.isConnected && !blocked() && !windowChanged()) target.focus()
  })
}

function ConfirmActions({ confirmLabel, cancelLabel, destructive }: ConfirmOptions) {
  const { resolve, dismiss } = useWindow<true>()
  return (
    <WindowActions>
      <AlertDialogCancel onClick={() => dismiss("cancel")}>{cancelLabel ?? "Cancelar"}</AlertDialogCancel>
      <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={() => resolve(true)}>
        {confirmLabel ?? "Confirmar"}
      </AlertDialogAction>
    </WindowActions>
  )
}

async function confirm(controller: WindowController<WindowContent>, options: ConfirmOptions): Promise<boolean> {
  const result = await controller.open<true>(
    {
      surface: "confirmation",
      title: options.title ?? "Confirmar ação",
      size: options.size,
      description: options.description,
      content: () => <ConfirmActions {...options} />,
    },
    activeElement(),
  )
  return result.status === "confirmed"
}

const locationNavigation: NavigationService = { go: (href) => window.location.assign(href) }

export function UiProvider({
  children,
  navigation = locationNavigation,
  feedback = feedbackService,
}: {
  children: ReactNode
  navigation?: NavigationService
  feedback?: FeedbackService
}) {
  const [controller] = useState(() => {
    const c: WindowController<WindowContent> = new WindowController<WindowContent>({
      restoreFocus: (target) => {
        const activeId = c.snapshot().activeId
        restoreFocus(target, () => c.snapshot().activeId !== activeId)
      },
      confirmDiscard: () =>
        confirm(c, {
          title: "Descartar alterações?",
          description: "Existem alterações não salvas. Deseja descartá-las?",
          confirmLabel: "Descartar",
          destructive: true,
        }),
    })
    return c
  })
  const snapshot = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  useEffect(() => () => controller.dispose(), [controller])

  const ui = useMemo<Ui<WindowContent>>(
    () => ({
      windows: {
        open: <TResult,>(options: OpenWindowOptions<WindowContent>, focusTarget: FocusTarget | null = activeElement()) =>
          controller.open<TResult>(options, focusTarget),
        confirm: (options) => confirm(controller, options),
      },
      feedback,
      navigation,
    }),
    [controller, feedback, navigation],
  )

  return (
    <UiContext.Provider value={ui}>
      {children}
      <WindowHost controller={controller} windows={snapshot.windows} />
    </UiContext.Provider>
  )
}
