import { useEffect, useState } from "react";
import { SidebarMenuBadge } from "@platform/ui/components/sidebar";
import { ApiError, apiFetch } from "@platform/ui/lib/api";
import { API } from "./inovafarma-api";

const VINCULO_ALTERADO = "inovafarma:vinculo-alterado";

/** Avisa o badge do menu de que a contagem mudou. */
export const avisarVinculoAlterado = () => window.dispatchEvent(new Event(VINCULO_ALTERADO));

/**
 * Quantos Colaboradores ativos estão pendentes; sem pendentes ou sem resposta do ERP, não mostra nada.
 * O menu só monta o badge para quem tem a Permission da tela; se o servidor negar mesmo assim (403), para de consultar.
 */
export function ColaboradoresPendentesBadge() {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let ativo = true;
    let negado = false;
    const buscar = () => {
      if (negado) return;
      apiFetch<{ total: number }>(`${API}/colaboradores/pendentes`)
        .then((r) => ativo && setTotal(r.total))
        .catch((err: unknown) => {
          if (!ativo) return;
          if (err instanceof ApiError && err.status === 403) negado = true;
          setTotal(0);
        });
    };
    buscar();
    window.addEventListener(VINCULO_ALTERADO, buscar);
    return () => {
      ativo = false;
      window.removeEventListener(VINCULO_ALTERADO, buscar);
    };
  }, []);

  if (total === 0) return null;
  return (
    <SidebarMenuBadge tone="destructive" aria-label={`${total} Colaboradores pendentes`}>
      {total}
    </SidebarMenuBadge>
  );
}
