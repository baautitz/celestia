import type {
  CloseReason,
  DiscardRequest,
  DismissRequestReason,
  FocusTarget,
  OpenWindowOptions,
  WindowId,
  WindowPorts,
  WindowResult,
  WindowSnapshot,
  WindowSnapshotEntry,
} from "../contracts/windows.ts"

interface PendingWindow<TContent> extends WindowSnapshotEntry<TContent> {
  resolve: (result: WindowResult<never>) => void
  // consultado ao fechar, não empurrado a cada alteração
  dirtyCheck: (() => boolean) | null
}

const defaultPorts: WindowPorts = {
  confirmDiscard: async () => false,
  restoreFocus: () => undefined,
}

export class WindowController<TContent = unknown> {
  private readonly listeners = new Set<() => void>()
  private readonly pendingClose = new Set<WindowId>()
  private readonly ports: WindowPorts
  private windows: PendingWindow<TContent>[] = []
  private sequence = 0
  private disposed = false
  private current: WindowSnapshot<TContent> = { windows: [], activeId: null }

  constructor(ports: Partial<WindowPorts> = {}) {
    this.ports = { ...defaultPorts, ...ports }
  }

  snapshot = (): WindowSnapshot<TContent> => this.current

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  open<TResult>(
    options: OpenWindowOptions<TContent>,
    focusTarget: FocusTarget | null = null,
  ): Promise<WindowResult<TResult>> {
    if (this.disposed) {
      return Promise.resolve({ status: "cancelled", reason: "unmounted" })
    }
    return new Promise<WindowResult<TResult>>((resolve) => {
      const id = `window-${++this.sequence}` as WindowId
      this.windows.push({
        id,
        options,
        focusTarget,
        dirtyCheck: null,
        resolve: resolve as (result: WindowResult<never>) => void,
      })
      this.publish()
    })
  }

  resolve<TResult>(id: WindowId, value: TResult): void {
    this.settle(id, { status: "confirmed", value })
  }

  dismiss(id: WindowId, reason: CloseReason = "cancel"): void {
    if (reason === "unmounted") {
      this.settle(id, { status: "cancelled", reason })
      return
    }
    this.requestDismiss(id, reason === "discarded" ? "cancel" : reason)
  }

  requestDismiss(id: WindowId, reason: DismissRequestReason = "cancel"): void {
    const top = this.top()
    if (!top || top.id !== id || this.pendingClose.has(id)) return

    if (!top.dirtyCheck?.()) {
      this.settle(id, { status: "cancelled", reason })
      return
    }

    // repetições enquanto a confirmação está aberta são ignoradas
    this.pendingClose.add(id)
    const request: DiscardRequest = { windowId: id, reason }
    let confirmation: Promise<boolean>
    try {
      confirmation = this.ports.confirmDiscard(request)
    } catch {
      this.pendingClose.delete(id)
      return
    }
    void confirmation.then(
      (discard) => {
        this.pendingClose.delete(id)
        if (discard) this.settle(id, { status: "cancelled", reason: "discarded" })
      },
      () => {
        this.pendingClose.delete(id)
      },
    )
  }

  setDirtyCheck(id: WindowId, check: (() => boolean) | null): void {
    const target = this.windows.find((w) => w.id === id)
    if (target) target.dirtyCheck = check
  }

  dismissAll(): void {
    if (!this.windows.length) return
    const closing = this.windows
    this.windows = []
    this.pendingClose.clear()
    this.publish()
    closing.forEach((w) => w.resolve({ status: "cancelled", reason: "unmounted" }))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.dismissAll()
    this.listeners.clear()
  }

  private top(): PendingWindow<TContent> | undefined {
    return this.windows.at(-1)
  }

  private settle(id: WindowId, result: WindowResult<unknown>): void {
    const top = this.top()
    if (!top || top.id !== id) return

    this.windows.pop()
    this.pendingClose.delete(id)
    this.publish()
    top.resolve(result as WindowResult<never>)

    if (!(result.status === "cancelled" && result.reason === "unmounted")) {
      try {
        this.ports.restoreFocus(top.focusTarget)
      } catch {
        // efeitos de foco não podem afetar uma Promise já liquidada
      }
    }
  }

  private publish(): void {
    const windows = this.windows.map(({ id, options, focusTarget }) => ({ id, options, focusTarget }))
    this.current = { windows, activeId: windows.at(-1)?.id ?? null }
    this.listeners.forEach((listener) => listener())
  }
}
