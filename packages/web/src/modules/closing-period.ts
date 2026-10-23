import { CalendarRange } from "lucide-react";
import { defineWebModule } from "@platform/ui/contracts/module";
import { ClosingPeriodsPage } from "@/pages/ClosingPeriodsPage";

export const closingPeriodModule = defineWebModule({
  id: "closing_period",
  entries: [
    {
      id: "closing-periods",
      label: "Períodos de Fechamento",
      icon: CalendarRange,
      path: "/closing-periods",
      group: "Fechamento",
      permission: "closing_period:period:read",
      component: ClosingPeriodsPage,
    },
  ],
});
