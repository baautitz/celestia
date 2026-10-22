import { ScrollText } from "lucide-react";
import { defineWebModule } from "@platform/ui/contracts/module";
import { AuditLogPage } from "@/pages/AuditLogPage";

export const auditModule = defineWebModule({
  id: "audit",
  entries: [
    {
      id: "audit",
      label: "Auditoria",
      title: "Audit Log",
      icon: ScrollText,
      path: "/audit",
      group: "Administração & IAM",
      permission: "system:audit:read",
      component: AuditLogPage,
    },
  ],
});
