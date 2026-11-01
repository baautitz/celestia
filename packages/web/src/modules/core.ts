import { Database } from "lucide-react";
import { defineWebModule } from "@platform/ui/contracts/module";
import { ERPsPage } from "@/pages/ERPsPage";

export const coreModule = defineWebModule({
  id: "core",
  sections: [
    { id: "closing", label: "Fechamento", order: 100 },
    { id: "reports", label: "Relatórios", order: 200 },
    { id: "admin", label: "Administração & IAM", order: 300 },
  ],
  entries: [
    {
      id: "erps",
      label: "ERPs",
      icon: Database,
      path: "/erps",
      section: "admin",
      order: 30,
      permission: "system:erps:manage",
      component: ERPsPage,
    },
  ],
});
