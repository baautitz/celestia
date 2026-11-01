import { MonitorSmartphone, Shield, Users } from "lucide-react";
import { defineWebModule } from "@platform/ui/contracts/module";
import { usersWebService } from "@/iam/UserFormWindow";
import { IAMUsersPage } from "@/pages/IAMUsersPage";
import { IAMRolesPage } from "@/pages/IAMRolesPage";
import { IAMDevicesPage } from "@/pages/IAMDevicesPage";

/** Usuários, Grupos e Dispositivos; oferece o cadastro de Usuário aos módulos que dependem de `iam`. */
export const iamModule = defineWebModule({
  id: "iam",
  services: { users: usersWebService },
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
  ],
});
