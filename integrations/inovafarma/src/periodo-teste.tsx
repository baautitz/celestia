import { useState } from "react";
import type { Periodo } from "./periodos";

const inicial = (periodos: Periodo[]) => (periodos.find((p) => p.status !== "closed") ?? periodos[0])?.id ?? "";

/** Dublê do serviço `closing_period:period` para os testes do Plugin: mesma regra de padrão, sem estado compartilhado. */
const periodo = {
  useSelectedPeriod: (periodos: Periodo[]) => {
    const [escolhido, setEscolhido] = useState<string | null>(null);
    return [periodos.some((p) => p.id === escolhido) ? (escolhido as string) : inicial(periodos), setEscolhido] as const;
  },
  PeriodSelect: () => null,
};

export const servicosFalsos = { useWebService: () => periodo };
