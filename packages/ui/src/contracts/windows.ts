export type WindowId = string & { readonly __windowId: unique symbol }

export type CloseReason = "cancel" | "escape" | "outside" | "discarded" | "unmounted"

export type DismissRequestReason = Extract<CloseReason, "cancel" | "escape" | "outside">

export type WindowResult<TResult> =
  | { status: "confirmed"; value: TResult }
  | { status: "cancelled"; reason: CloseReason }

export type WindowSurface = "dialog" | "sheet" | "confirmation"
export type WindowSize = "small" | "medium" | "large" | "full"

/** `content` é opaco para o controller; o host decide como renderizá-lo. */
export interface OpenWindowOptions<TContent = unknown> {
  title?: string
  description?: string
  surface?: WindowSurface
  size?: WindowSize
  content?: TContent
}

export interface ConfirmOptions {
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

/** Interface mínima para devolver o foco sem conhecer o DOM. */
export interface FocusTarget {
  focus(): void
}

export interface DiscardRequest {
  windowId: WindowId
  reason: DismissRequestReason
}

export interface WindowPorts {
  confirmDiscard: (request: DiscardRequest) => Promise<boolean>
  restoreFocus: (target: FocusTarget | null) => void
}

export interface WindowSnapshotEntry<TContent = unknown> {
  id: WindowId
  options: OpenWindowOptions<TContent>
  focusTarget: FocusTarget | null
}

export interface WindowSnapshot<TContent = unknown> {
  windows: readonly WindowSnapshotEntry<TContent>[]
  activeId: WindowId | null
}

export interface WindowService<TContent = unknown> {
  open<TResult>(
    options: OpenWindowOptions<TContent>,
    focusTarget?: FocusTarget | null,
  ): Promise<WindowResult<TResult>>
  confirm(options: ConfirmOptions): Promise<boolean>
}
