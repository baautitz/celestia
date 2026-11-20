import { useEffect, useRef } from "react"
import { useBlocker } from "react-router-dom"
import { useUi } from "../imperative/provider.tsx"

/** Uma tela com alterações pendentes: pergunta se pode descartá-las e é avisada quando o usuário descarta. */
interface Guard {
  ask: () => Promise<boolean>
  release: () => void
}

/** Telas guardadas no momento, da mais antiga à mais recente; cada uma entra e sai só com o próprio efeito. */
const guards: Guard[] = []
/** Pergunta aberta: chamadas simultâneas (roteador e encerrar sessão) compartilham a mesma resposta. */
let asking: Promise<boolean> | null = null

/**
 * Para saídas que encerram a tela sem passar pelo roteador antes, como encerrar a sessão.
 * Pergunta uma vez (a tela mais recente fala por todas); descartar libera todas as telas guardadas.
 */
export function confirmLeave(): Promise<boolean> {
  const top = guards[guards.length - 1]
  if (!top) return Promise.resolve(true)
  if (asking) return asking
  const snapshot = [...guards]
  asking = top
    .ask()
    .then((descartar) => {
      if (descartar) for (const guard of snapshot) guard.release()
      return descartar
    })
    .finally(() => {
      asking = null
    })
  return asking
}

/**
 * Enquanto `pending`, sair da tela pede confirmação: navegação interna e botão voltar pelo
 * roteador (exige roteador de dados), fechar ou recarregar pelo aviso nativo do navegador.
 */
export function useLeaveGuard(pending: boolean): void {
  const { windows } = useUi()
  const liberada = useRef(false)

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      pending && !liberada.current && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!pending) return
    // Armar de novo (novas alterações depois de um descarte) volta a pedir confirmação.
    liberada.current = false
    const guard: Guard = {
      ask: () =>
        windows.confirm({
          title: "Descartar alterações?",
          description: "Existem alterações não salvas. Deseja descartá-las?",
          confirmLabel: "Descartar",
          destructive: true,
        }),
      release: () => {
        liberada.current = true
      },
    }
    const avisarNavegador = (event: BeforeUnloadEvent) => event.preventDefault()
    guards.push(guard)
    window.addEventListener("beforeunload", avisarNavegador)
    return () => {
      const index = guards.indexOf(guard)
      if (index !== -1) guards.splice(index, 1)
      window.removeEventListener("beforeunload", avisarNavegador)
    }
  }, [pending, windows])

  useEffect(() => {
    if (blocker.state !== "blocked") return
    void confirmLeave().then((descartar) => (descartar ? blocker.proceed() : blocker.reset()))
  }, [blocker])
}
