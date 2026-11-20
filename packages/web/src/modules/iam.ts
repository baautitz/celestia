import { MonitorSmartphone, Shield, Users } from "lucide-react";
import { defineWebModule } from "@platform/ui/contracts/module";
import { usersWebService } from "@/iam/UserFormWindow";
import { lazyPage } from "@/lib/lazy-page";
const IAMUsersPage = lazyPage(() => import("@/pages/IAMUsersPage"), "IAMUsersPage");
const IAMRolesPage = lazyPage(() => import("@/pages/IAMRolesPage"), "IAMRolesPage");
const IAMDevicesPage = lazyPage(() => import("@/pages/IAMDevicesPage"), "IAMDevicesPage");

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
