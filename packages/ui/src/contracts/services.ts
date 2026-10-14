import type { WindowService } from "./windows.ts"

export type NotificationType = "success" | "error" | "info" | "warning" | "loading"

export interface NotificationOptions {
  title: string
  description?: string
  type?: NotificationType
  duration?: number
}

export interface FeedbackService {
  notify(options: NotificationOptions): void
  notifyError(error: Error, fallbackTitle?: string): void
}

export interface NavigationService {
  go(href: string, options?: { replace?: boolean }): void
}

export interface Ui<TContent = unknown> {
  windows: WindowService<TContent>
  feedback: FeedbackService
  navigation: NavigationService
}
