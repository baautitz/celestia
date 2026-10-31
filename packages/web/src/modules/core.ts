import { Database, MonitorSmartphone, Shield, Users } from "lucide-react";
import { defineWebModule } from "@platform/ui/contracts/module";
import { IAMUsersPage } from "@/pages/IAMUsersPage";
import { IAMRolesPage } from "@/pages/IAMRolesPage";
import { IAMDevicesPage } from "@/pages/IAMDevicesPage";
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
      id: "users",
      label: "Usuários",
      title: "Gestão de Usuários",
      icon: Users,
      path: "/iam/users",
      section: "admin",
      order: 10,
      permission: "system:users:read",
      component: IAMUsersPage,
    },
    {
      id: "roles",
      label: "Grupos",
      icon: Shield,
      path: "/iam/roles",
      section: "admin",
      order: 20,
      permission: "system:roles:read",
      component: IAMRolesPage,
    },
    {
      id: "devices",
      label: "Dispositivos",
      icon: MonitorSmartphone,
      path: "/iam/devices",
      section: "admin",
      order: 25,
      permission: "system:devices:read",
      component: IAMDevicesPage,
    },
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
