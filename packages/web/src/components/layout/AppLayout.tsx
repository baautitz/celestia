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
import { AppHeader, AppMain, BrandMark, Show, Stack, Text } from "@platform/ui/components/layout";
import { LogOut, ChevronDown, ArrowLeft, Building2 } from "lucide-react";
import { menuSections } from "@/modules";

const SidebarAutoClose: React.FC = () => {
  const { setOpenMobile } = useSidebar();
  const location = useLocation();

  useEffect(() => {
    setOpenMobile(false);
  }, [location.pathname, setOpenMobile]);

  return null;
};

export const AppLayout: React.FC = () => {
  const { user, logout, hasPermission } = useAuth();
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

  const sections = menuSections(hasPermission);
  const entries = sections.flatMap((s) => s.entries);
  const current = entries.find((e) => location.pathname.startsWith(e.path));
  const pageTitle = current ? (current.title ?? current.label) : "Painel de Controle";

  return (
    <SidebarProvider>
      <SidebarAutoClose />
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link to="/" />}>
                <BrandMark>
                  <Building2 />
                </BrandMark>
                <Stack grow>
                  <Text variant="small" weight="semibold" truncate>
                    Celestia
                  </Text>
                </Stack>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {sections.map((section) => (
            <SidebarGroup key={section.id}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarMenu>
                {section.entries.map((entry) => (
                  <SidebarMenuItem key={entry.id}>
                    <SidebarMenuButton
                      isActive={location.pathname.startsWith(entry.path)}
                      tooltip={entry.label}
                      render={<Link to={entry.path} />}
                    >
                      <entry.icon />
                      <Text>{entry.label}</Text>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          {user && (
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <SidebarMenuButton>
                        <Avatar>
                          <AvatarFallback>{getInitials(user.fullname)}</AvatarFallback>
                        </Avatar>
                        <Stack grow>
                          <Text variant="small" weight="semibold" truncate>
                            {user.fullname}
                          </Text>
                          <Text variant="caption" tone="muted" truncate>
                            {user.username}
                          </Text>
                        </Stack>
                        <ChevronDown />
                      </SidebarMenuButton>
                    }
                  />
                  <DropdownMenuContent side="bottom" align="end" sideOffset={4}>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>
                        <Stack direction="row" align="center" gap="field">
                          <Avatar>
                            <AvatarFallback>{getInitials(user.fullname)}</AvatarFallback>
                          </Avatar>
                          <Stack grow>
                            <Text variant="small" weight="semibold" truncate>
                              {user.fullname}
                            </Text>
                            <Text variant="caption" tone="muted" truncate>
                              {user.email || user.username}
                            </Text>
                          </Stack>
                        </Stack>
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <Stack direction="row" align="center" justify="between" padding="compact">
                        <Text variant="caption" tone="muted">
                          Grupo / Perfil
                        </Text>
                        <Badge variant="secondary">{user.role}</Badge>
                      </Stack>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} variant="destructive">
                      <LogOut />
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
        <AppHeader>
          <Stack direction="row" align="center" gap="field" grow>
            <SidebarTrigger />
            {backTo && (
              <Button
                variant="ghost"
                size="icon"
                nativeButton={false}
                render={<Link to={backTo} />}
                title="Voltar"
                aria-label="Voltar"
              >
                <ArrowLeft />
              </Button>
            )}
            <Show on="desktop">
              <Separator orientation="vertical" />
            </Show>
            <Breadcrumb>
              <BreadcrumbList>
                <Show on="desktop">
                  <BreadcrumbItem>
                    <BreadcrumbLink render={<Link to="/" />}>Início</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </Show>
                <BreadcrumbItem>
                  <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </Stack>

          {actions && (
            <Stack direction="row" align="center" gap="field" shrink={false}>
              {actions}
            </Stack>
          )}
        </AppHeader>

        <AppMain>
          <Outlet />
        </AppMain>
      </SidebarInset>
    </SidebarProvider>
  );
};
