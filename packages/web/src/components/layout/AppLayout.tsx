import React, { useEffect } from "react";
import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useHeaderActions } from "@/context/HeaderActionsContext";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from "@platform/ui/components/sidebar";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@platform/ui/components/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@platform/ui/components/dropdown-menu";
import { Avatar, AvatarFallback } from "@platform/ui/components/avatar";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Separator } from "@platform/ui/components/separator";
import {
  LayoutDashboard,
  Users,
  Shield,
  LogOut,
  ChevronDown,
  ArrowLeft,
  Building2,
  Layers,
  Database,
  FileCode,
} from "lucide-react";

const SidebarAutoClose: React.FC = () => {
  const { setOpenMobile } = useSidebar();
  const location = useLocation();

  useEffect(() => {
    setOpenMobile(false);
  }, [location.pathname, setOpenMobile]);

  return null;
};

export const AppLayout: React.FC = () => {
  const { user, logout, hasAnyPermission } = useAuth();
  const { actions, backTo } = useHeaderActions();
  const location = useLocation();
  const navigate = useNavigate();


  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const getInitials = (name?: string) => {
    if (!name) return "US";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  const getPageTitle = () => {
    if (location.pathname.startsWith("/dashboards/")) return "Dashboard";
    if (location.pathname.startsWith("/dashboards")) return "Dashboards";
    if (location.pathname.startsWith("/workspaces/")) return "Área de Trabalho";
    if (location.pathname.startsWith("/workspaces")) return "Áreas de Trabalho";
    if (location.pathname.startsWith("/iam/users")) return "Gestão de Usuários";
    if (location.pathname.startsWith("/iam/roles")) return "Grupos";
    if (location.pathname.startsWith("/erps")) return "ERPs";
    if (location.pathname.startsWith("/admin/dashboards")) return "Dashboards";
    return "Painel de Controle";
  };

  return (
    <SidebarProvider>
      <SidebarAutoClose />
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" render={<Link to="/workspaces" />}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-none bg-primary text-primary-foreground">
                  <Building2 className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Celestia</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Celestia</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location.pathname === "/workspaces" && !location.pathname.startsWith("/workspaces/")}
                  tooltip="Áreas de Trabalho"
                  render={<Link to="/workspaces" />}
                >
                  <LayoutDashboard className="size-4" />
                  <span>Áreas de Trabalho</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location.pathname.startsWith("/dashboards")}
                  tooltip="Dashboards"
                  render={<Link to="/dashboards" />}
                >
                  <Layers className="size-4" />
                  <span>Dashboards</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          {hasAnyPermission("system:users:read", "system:roles:read", "system:sources:manage", "system:recipes:read") && (
            <SidebarGroup>
              <SidebarGroupLabel>Administração & IAM</SidebarGroupLabel>
              <SidebarMenu>
                {hasAnyPermission("system:users:read") && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={location.pathname.startsWith("/iam/users")}
                      tooltip="Usuários"
                      render={<Link to="/iam/users" />}
                    >
                      <Users className="size-4" />
                      <span>Usuários</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {hasAnyPermission("system:roles:read") && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={location.pathname.startsWith("/iam/roles")}
                      tooltip="Grupos"
                      render={<Link to="/iam/roles" />}
                    >
                      <Shield className="size-4" />
                      <span>Grupos</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {hasAnyPermission("system:recipes:read") && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={location.pathname.startsWith("/admin/dashboards")}
                      tooltip="Gerenciar Dashboards"
                      render={<Link to="/admin/dashboards" />}
                    >
                      <FileCode className="size-4" />
                      <span>Gerenciar Dashboards</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {hasAnyPermission("system:sources:manage") && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={location.pathname.startsWith("/erps")}
                      tooltip="ERPs"
                      render={<Link to="/erps" />}
                    >
                      <Database className="size-4" />
                      <span>ERPs</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroup>
          )}
        </SidebarContent>

        <SidebarFooter>
          {user && (
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <SidebarMenuButton size="lg">
                        <Avatar className="size-8">
                          <AvatarFallback>{getInitials(user.fullname)}</AvatarFallback>
                        </Avatar>
                        <div className="grid flex-1 text-left text-sm leading-tight">
                          <span className="truncate font-semibold">{user.fullname}</span>
                          <span className="truncate text-xs text-muted-foreground">{user.username}</span>
                        </div>
                        <ChevronDown className="ml-auto size-4" />
                      </SidebarMenuButton>
                    }
                  />
                  <DropdownMenuContent
                    className="min-w-56"
                    side="bottom"
                    align="end"
                    sideOffset={4}
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="p-0 font-normal">
                        <div className="flex items-center gap-2 px-2 py-2 text-left text-sm">
                          <Avatar className="size-8">
                            <AvatarFallback>{getInitials(user.fullname)}</AvatarFallback>
                          </Avatar>
                          <div className="grid flex-1 text-left text-sm leading-tight">
                            <span className="truncate font-semibold">{user.fullname}</span>
                            <span className="truncate text-xs text-muted-foreground">{user.email || user.username}</span>
                          </div>
                        </div>
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
                        <span>Grupo / Perfil</span>
                        <Badge variant="secondary">{user.role}</Badge>
                      </div>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-destructive cursor-pointer">
                      <LogOut className="mr-2 size-4" />
                      Sair da Plataforma
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center border-b border-border/50 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 px-3 md:px-6 transition-[width,height] ease-linear">
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <SidebarTrigger className="-ml-1 size-8 shrink-0" />
            {backTo && (
              <Button
                variant="ghost"
                size="icon"
                nativeButton={false}
                render={<Link to={backTo} />}
                title="Voltar"
                aria-label="Voltar"
                className="size-8 shrink-0"
              >
                <ArrowLeft className="size-4" />
              </Button>
            )}
            <Separator orientation="vertical" className="h-4 hidden sm:block my-auto" />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="items-center">
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink render={<Link to="/workspaces" />} className="cursor-pointer text-sm">
                    Início
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block my-auto self-center" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-sm font-medium truncate">{getPageTitle()}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          {actions && (
            <div className="flex items-center gap-1.5 md:gap-2 ml-auto shrink-0">
              {actions}
            </div>
          )}
        </header>

        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};
