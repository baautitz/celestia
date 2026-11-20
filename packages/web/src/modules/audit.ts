import { ScrollText } from "lucide-react";
import { defineWebModule } from "@platform/ui/contracts/module";
import { lazyPage } from "@/lib/lazy-page";
const AuditLogPage = lazyPage(() => import("@/pages/AuditLogPage"), "AuditLogPage");

export const auditModule = defineWebModule({
  id: "audit",
  entries: [
    {
      id: "audit",
      label: "Auditoria",
      title: "Audit Log",
      icon: ScrollText,
      path: "/audit",
      section: "admin",
      order: 40,
      permission: "system:audit:read",
      component: AuditLogPage,
    },
  ],
});
