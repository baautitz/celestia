import { useMemo, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/alert-dialog.tsx"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog.tsx"
import { ScrollArea } from "../components/scroll-area.tsx"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "../components/sheet.tsx"
import type { DismissRequestReason, WindowSnapshotEntry } from "../contracts/windows.ts"
import type { WindowController } from "./controller.ts"
import { WindowContext, WindowFooterContext } from "./use-window.tsx"
import type { WindowHandle } from "./use-window.tsx"

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
    if (open) return
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
        ) : surface === "sheet" ? (
          <Sheet open onOpenChange={onOpenChange}>
            <SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl">
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
            <DialogContent className={options.size === "small" ? "sm:max-w-md" : "sm:max-w-lg"}>
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                {options.description && <DialogDescription>{options.description}</DialogDescription>}
              </DialogHeader>
              {body}
              <DialogFooter ref={setFooter} className="gap-2" />
            </DialogContent>
          </Dialog>
        )}
      </WindowFooterContext.Provider>
    </WindowContext.Provider>
  )
}
