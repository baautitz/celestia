import { CalendarRange } from "lucide-react";
import { defineWebModule } from "@platform/ui/contracts/module";
import { lazyPage } from "@/lib/lazy-page";
import { PeriodSelect } from "@/closing-period/period-select";
import { useSelectedPeriod } from "@/closing-period/period-selection";
const ClosingPeriodsPage = lazyPage(() => import("@/pages/ClosingPeriodsPage"), "ClosingPeriodsPage");

export const closingPeriodModule = defineWebModule({
  id: "closing_period",
  // Seleção compartilhada entre as telas dos Plugins que trabalham com período (`useWebService("closing_period", "period")`).
  services: { period: { useSelectedPeriod, PeriodSelect } },
  entries: [
    {
      id: "closing-periods",
      label: "Períodos de Fechamento",
      icon: CalendarRange,
      path: "/closing-periods",
      section: "closing",
      order: 10,
      permission: "closing_period:period:read",
      component: ClosingPeriodsPage,
    },
  ],
});
