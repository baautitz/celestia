import { HeaderToolbar } from "@platform/ui/context/header-actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { formatDate } from "@platform/ui/lib/format";

export interface PeriodOption {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "open" | "closed";
}

const label = (p: PeriodOption) => `${p.name} (${formatDate(p.startDate)} a ${formatDate(p.endDate)})${p.status === "closed" ? " · Fechado" : ""}`;

/** Seletor do Período de Fechamento na barra global, enquanto a tela estiver montada; a escolha vem e vai pelo `useSelectedPeriod`. */
export function PeriodSelect({ periods, value, onChange }: { periods: PeriodOption[]; value: string; onChange: (id: string) => void }) {
  return (
    <HeaderToolbar>
      <Select value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger aria-label="Período de Fechamento" fit>
          <SelectValue>{(id: string) => periods.find((p) => p.id === id)?.name ?? "Selecione"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {periods.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {label(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </HeaderToolbar>
  );
}
