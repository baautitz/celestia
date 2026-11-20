import type { ComponentType } from "react";
import { useWebService } from "@platform/ui/contracts/web-services";
import type { Periodo } from "./periodos";

/** Formato do serviço `closing_period:period`, oferecido pelo módulo Períodos de Fechamento. */
interface PeriodService {
  useSelectedPeriod: (periods: Periodo[]) => [string, (id: string) => void];
  PeriodSelect: ComponentType<{ periods: Periodo[]; value: string; onChange: (id: string) => void }>;
}

const useService = () => useWebService<PeriodService>("closing_period", "period");

/** Período selecionado, compartilhado entre as telas; recorre ao aberto mais recente quando a escolha não existe na lista. */
export const usePeriodoSelecionado = (periodos: Periodo[]) => useService().useSelectedPeriod(periodos);

export function SeletorPeriodo({ periodos, valor, onChange }: { periodos: Periodo[]; valor: string; onChange: (id: string) => void }) {
  const { PeriodSelect } = useService();
  return <PeriodSelect periods={periodos} value={valor} onChange={onChange} />;
}
