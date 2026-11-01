import { useEffect, useRef } from "react"
import { useBlocker } from "react-router-dom"
import { useUi } from "../imperative/provider.tsx"

/** Pergunta da tela com alterações pendentes; só uma tela está montada por vez. */
let perguntar: (() => Promise<boolean>) | null = null

/** Para saídas que encerram a tela sem passar pelo roteador antes, como encerrar a sessão. */
export function confirmLeave(): Promise<boolean> {
  return perguntar ? perguntar() : Promise.resolve(true)
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
    const pergunta = async () => {
      const descartar = await windows.confirm({
        title: "Descartar alterações?",
        description: "Existem alterações não salvas. Deseja descartá-las?",
        confirmLabel: "Descartar",
        destructive: true,
      })
      liberada.current = descartar
      return descartar
    }
    const avisarNavegador = (event: BeforeUnloadEvent) => event.preventDefault()
    perguntar = pergunta
    window.addEventListener("beforeunload", avisarNavegador)
    return () => {
      perguntar = null
      window.removeEventListener("beforeunload", avisarNavegador)
    }
  }, [pending, windows])

  useEffect(() => {
    if (blocker.state !== "blocked") return
    void confirmLeave().then((descartar) => (descartar ? blocker.proceed() : blocker.reset()))
  }, [blocker])
}
