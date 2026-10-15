import { useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import type { NavigationService } from "../contracts/services.ts"

export function useRouterNavigation(): NavigationService {
  const navigate = useNavigate()
  const go = useCallback(
    (href: string, options?: { replace?: boolean }) => navigate(href, { replace: options?.replace }),
    [navigate],
  )
  return useMemo(() => ({ go }), [go])
}
