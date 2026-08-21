import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, Outlet } from "react-router-dom";
import type { RecipeSummary } from "@platform/shared";
import { useAuth } from "@/context/AuthContext";
import { useHeaderActions } from "@/context/HeaderActionsContext";
import { api } from "@/lib/api-client";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarMenuSkeleton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  LayoutDashboard,
  Users,
  Shield,
  LogOut,
  ChevronDown,
  ChevronRight,
  Building2,
  Layers,
} from "lucide-react";

export const AppLayout: React.FC = () => {
  const { user, logout, hasAnyPermission } = useAuth();
  const { actions } = useHeaderActions();
  const location = useLocation();
  const navigate = useNavigate();

  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoadingRecipes(true);
    api.recipes.list().then((data) => {
      setRecipes(data);
      setLoadingRecipes(false);
    }).catch(() => {
      setRecipes([]);
      setLoadingRecipes(false);
    });
  }, [user]);

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
    if (location.pathname.startsWith("/recipes/")) return "Modelo — Dashboard";
    if (location.pathname.startsWith("/workspaces/")) return "Área de Trabalho";
    if (location.pathname.startsWith("/workspaces")) return "Áreas de Trabalho";
    if (location.pathname.startsWith("/iam/users")) return "Gestão de Usuários";
    if (location.pathname.startsWith("/iam/roles")) return "Grupos de Acesso & Permissões";
    return "Painel de Controle";
  };

  return (
    <SidebarProvider>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" onClick={() => navigate("/workspaces")}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-none bg-primary text-primary-foreground">
                  <Building2 className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">SDUI Enterprise</span>
                  <span className="truncate text-xs text-muted-foreground">Plataforma de Gestão</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location.pathname === "/workspaces" && !location.pathname.startsWith("/workspaces/")}
                  tooltip="Áreas de Trabalho"
                  onClick={() => navigate("/workspaces")}
                >
                  <LayoutDashboard className="size-4" />
                  <span>Áreas de Trabalho</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <Collapsible defaultOpen className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger render={<SidebarMenuButton />}>
                    <Layers className="size-4" />
                    <span>Modelos</span>
                    <ChevronRight className="ml-auto size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {loadingRecipes ? (
                        Array.from({ length: 2 }).map((_, i) => (
                          <SidebarMenuSubItem key={i}>
                            <SidebarMenuSkeleton showIcon />
                          </SidebarMenuSubItem>
                        ))
                      ) : recipes.length === 0 ? (
                        <SidebarMenuSubItem>
                          <span className="px-2 py-1 text-xs text-muted-foreground">
                            Nenhum modelo disponível
                          </span>
                        </SidebarMenuSubItem>
                      ) : (
                        recipes.map((recipe) => (
                          <SidebarMenuSubItem key={recipe.id}>
                            <SidebarMenuSubButton
                              render={<button type="button" />}
                              isActive={location.pathname === `/recipes/${recipe.id}`}
                              onClick={() => navigate(`/recipes/${recipe.id}`)}
                              className="w-full"
                            >
                              <span>{recipe.name}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroup>

          {hasAnyPermission("system:users:read", "system:roles:read") && (
            <SidebarGroup>
              <SidebarGroupLabel>Administração & IAM</SidebarGroupLabel>
              <SidebarMenu>
                {hasAnyPermission("system:users:read") && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={location.pathname.startsWith("/iam/users")}
                      tooltip="Usuários"
                      onClick={() => navigate("/iam/users")}
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
                      tooltip="Grupos de Acesso"
                      onClick={() => navigate("/iam/roles")}
                    >
                      <Shield className="size-4" />
                      <span>Grupos de Acesso</span>
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
        <header className="flex h-14 shrink-0 items-center border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-3 md:px-6 transition-[width,height] ease-linear">
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <SidebarTrigger className="-ml-1 size-8 shrink-0" />
            <Separator orientation="vertical" className="h-4 hidden sm:block" />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink onClick={() => navigate("/workspaces")} className="cursor-pointer text-sm">
                    Início
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-sm font-medium truncate">{getPageTitle()}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          {actions && (
            <div className="flex items-center gap-1.5 md:gap-2 ml-2 shrink-0 overflow-x-auto">
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
