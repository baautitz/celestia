import { Database } from "lucide-react";
import { defineWebModule } from "@platform/ui/contracts/module";
import { lazyPage } from "@/lib/lazy-page";
const ERPsPage = lazyPage(() => import("@/pages/ERPsPage"), "ERPsPage");

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
