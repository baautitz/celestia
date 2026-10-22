import { Database, Shield, Users } from "lucide-react";
import { defineWebModule } from "@platform/ui/contracts/module";
import { IAMUsersPage } from "@/pages/IAMUsersPage";
import { IAMRolesPage } from "@/pages/IAMRolesPage";
import { ERPsPage } from "@/pages/ERPsPage";

const GROUP = "Administração & IAM";

export const coreModule = defineWebModule({
  id: "core",
  entries: [
    {
      id: "users",
      label: "Usuários",
      title: "Gestão de Usuários",
      icon: Users,
      path: "/iam/users",
      group: GROUP,
      permission: "system:users:read",
      component: IAMUsersPage,
    },
    {
      id: "roles",
      label: "Grupos",
      icon: Shield,
      path: "/iam/roles",
      group: GROUP,
      permission: "system:roles:read",
      component: IAMRolesPage,
    },
    {
      id: "erps",
      label: "ERPs",
      icon: Database,
      path: "/erps",
      group: GROUP,
      permission: "system:erps:manage",
      component: ERPsPage,
    },
  ],
});
