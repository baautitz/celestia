import { useEffect, useMemo, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/alert-dialog.tsx"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog.tsx"
import { ScrollArea } from "../components/scroll-area.tsx"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "../components/sheet.tsx"
import type { DismissRequestReason, WindowSize, WindowSnapshotEntry } from "../contracts/windows.ts"
import type { WindowController } from "./controller.ts"
import { WindowContext, WindowFooterContext } from "./use-window.tsx"
import type { WindowHandle } from "./use-window.tsx"

/** Largura do diálogo por `size`; `medium` é o padrão. `full` ocupa a tela toda no celular e rola só o corpo, com cabeçalho e rodapé fixos. */
const DIALOG_WIDTH: Record<WindowSize, string> = {
  small: "sm:max-w-md",
  medium: "sm:max-w-lg",
  large: "sm:max-w-3xl",
  full: "flex h-svh max-w-full flex-col gap-0 p-0 sm:h-auto sm:max-h-[90svh] sm:max-w-6xl",
  screen: "flex h-svh max-w-full flex-col gap-0 p-0 sm:h-[90svh] sm:w-[90vw] sm:max-w-[90vw]",
}

/** O elemento focado ao abrir a janela, com o que o identifica caso a tela o redesenhe enquanto a janela está aberta. */
interface FocoAnterior {
  el: HTMLElement
  id: string
  rotulo: string | null
}

function capturarFoco(): FocoAnterior | null {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || el === document.body) return null
  return { el, id: el.id, rotulo: el.getAttribute("aria-label") }
}

/**
 * Devolve o foco ao que o tinha antes de a janela abrir (Esc, Cancelar ou concluir). Se a tela redesenhou o elemento
 * (ex.: a tabela recarrega ao fechar), procura o equivalente por id ou rótulo por até 1s, sem tirar o foco de quem já o tomou.
 */
function restaurarFoco(anterior: FocoAnterior | null) {
  if (!anterior) return
  let tentativas = 0
  const tentar = () => {
    const atual = document.activeElement
    if (atual && atual !== document.body && !atual.closest("[role='dialog'], [role='alertdialog']") ) return
    const alvo = anterior.el.isConnected
      ? anterior.el
      : anterior.id
        ? document.getElementById(anterior.id)
        : anterior.rotulo
          ? document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(anterior.rotulo)}"]`)
          : null
    if (alvo) {
      alvo.focus()
      return
    }
    if (++tentativas < 10) setTimeout(tentar, 100)
  }
  setTimeout(tentar, 0)
}

/** Conteúdo de uma janela: componente sem props (quem abre fecha sobre os dados). */
export type WindowContent = ComponentType

export function WindowHost({ controller, windows }: {
  controller: WindowController<WindowContent>
  windows: readonly WindowSnapshotEntry<WindowContent>[]
}) {
  return windows.map((entry) => <ManagedWindow key={entry.id} entry={entry} controller={controller} />)
}

function ManagedWindow({ entry, controller }: {
  entry: WindowSnapshotEntry<WindowContent>
  controller: WindowController<WindowContent>
}) {
  const { id, options } = entry
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const [titleOverride, setTitle] = useState<ReactNode>(null)
  const [focoAnterior] = useState(capturarFoco)
  useEffect(() => () => restaurarFoco(focoAnterior), [focoAnterior])
  const title = titleOverride ?? options.title
  const handle = useMemo<WindowHandle>(() => ({
    setTitle,
    resolve: (value) => controller.resolve(id, value),
    dismiss: (reason) => controller.dismiss(id, reason),
    setDirtyCheck: (check) => controller.setDirtyCheck(id, check),
  }), [controller, id])

  const Content = options.content
  const body = Content ? <Content /> : null
  // `open` é sempre true: o controller remove a entrada ao liquidar.
  const onOpenChange = (open: boolean, details: { reason: string }) => {
    if (open || options.dismissible === false) return
    const reason: DismissRequestReason =
      details.reason === "escape-key" ? "escape" : details.reason === "outside-press" ? "outside" : "cancel"
    controller.requestDismiss(id, reason)
  }
  const surface = options.surface ?? "dialog"

  return (
    <WindowContext.Provider value={handle}>
      <WindowFooterContext.Provider value={footer}>
        {surface === "confirmation" ? (
          <AlertDialog open onOpenChange={onOpenChange}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{title}</AlertDialogTitle>
                {options.description && <AlertDialogDescription className="break-words">{options.description}</AlertDialogDescription>}
              </AlertDialogHeader>
              {body}
              <AlertDialogFooter ref={setFooter} />
            </AlertDialogContent>
          </AlertDialog>
        ) : surface === "sheet" || surface === "drawer" ? (
          <Sheet open onOpenChange={onOpenChange}>
            <SheetContent
              side={surface === "drawer" ? "bottom" : "right"}
              className={surface === "drawer" ? "flex max-h-[85svh] flex-col p-0" : "flex flex-col p-0 sm:max-w-xl"}
            >
              <SheetHeader className="p-6 border-b shrink-0">
                <SheetTitle>{title}</SheetTitle>
                {options.description && <SheetDescription>{options.description}</SheetDescription>}
              </SheetHeader>
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-6 flex flex-col gap-6">{body}</div>
              </ScrollArea>
              <SheetFooter ref={setFooter} className="p-6 border-t shrink-0 flex flex-row justify-end gap-2 bg-popover" />
            </SheetContent>
          </Sheet>
        ) : (
          <Dialog open onOpenChange={onOpenChange}>
            {options.size === "full" || options.size === "screen" ? (
              <DialogContent className={DIALOG_WIDTH[options.size]}>
                <DialogHeader className="p-4 border-b shrink-0">
                  <DialogTitle>{title}</DialogTitle>
                  {options.description && <DialogDescription>{options.description}</DialogDescription>}
                </DialogHeader>
                <div className="@container flex-1 min-h-0 overflow-y-auto p-4">{body}</div>
                <DialogFooter ref={setFooter} className="p-4 border-t shrink-0 gap-2 empty:hidden" />
              </DialogContent>
            ) : (
              <DialogContent className={`${DIALOG_WIDTH[options.size ?? "medium"]} max-h-[90svh] grid-rows-[auto_minmax(0,1fr)_auto]`} showCloseButton={options.dismissible !== false}>
                <DialogHeader>
                  <DialogTitle>{title}</DialogTitle>
                  {options.description && <DialogDescription>{options.description}</DialogDescription>}
                </DialogHeader>
                <div className="-m-1 min-h-0 overflow-x-hidden overflow-y-auto p-1">{body}</div>
                <DialogFooter ref={setFooter} className="gap-2 empty:hidden" />
              </DialogContent>
            )}
          </Dialog>
        )}
      </WindowFooterContext.Provider>
    </WindowContext.Provider>
  )
}
