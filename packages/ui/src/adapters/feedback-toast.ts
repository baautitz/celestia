import { toast } from "../components/toast.tsx"
import type { FeedbackService, NotificationOptions } from "../contracts/services.ts"

function notify({ title, description, type = "info", duration }: NotificationOptions): void {
  toast.add({ title, description, type, timeout: duration })
}

/** Implementa FeedbackService sobre o toast do projeto (Base UI Toast). */
export const feedbackService: FeedbackService = {
  notify,
  notifyError: (error, fallbackTitle = "Erro") =>
    notify({ title: fallbackTitle, description: error.message, type: "error" }),
}
