import { useEffect, useState } from "react";
import { SidebarMenuBadge } from "@platform/ui/components/sidebar";
import { apiFetch } from "@platform/ui/lib/api";

const VINCULO_ALTERADO = "inovafarma:vinculo-alterado";

/** Avisa o badge do menu de que a contagem mudou. */
export const avisarVinculoAlterado = () => window.dispatchEvent(new Event(VINCULO_ALTERADO));

/** Quantos Colaboradores ativos estão pendentes; sem pendentes ou sem resposta do ERP, não mostra nada. */
export function ColaboradoresPendentesBadge() {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let ativo = true;
    const buscar = () => {
      apiFetch<{ total: number }>("/api/m/inovafarma/colaboradores/pendentes")
        .then((r) => ativo && setTotal(r.total))
        .catch(() => ativo && setTotal(0));
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
