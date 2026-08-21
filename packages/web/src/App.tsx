import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { WorkspaceDetailPage } from "./pages/WorkspaceDetailPage";
import { RecipeDashboardPage } from "./pages/RecipeDashboardPage";
import { IAMUsersPage } from "./pages/IAMUsersPage";
import { IAMRolesPage } from "./pages/IAMRolesPage";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

export const App: React.FC = () => {
  return (
    <TooltipProvider>
      <Routes>
        {/* Rota Pública de Autenticação */}
        <Route path="/login" element={<LoginPage />} />

        {/* Rotas Protegidas Autenticadas com Layout Corporativo */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/workspaces" replace />} />
            <Route path="/workspaces" element={<WorkspacesPage />} />
            <Route path="/workspaces/:id" element={<WorkspaceDetailPage />} />
            <Route path="/recipes/:recipeId" element={<RecipeDashboardPage />} />

            {/* Rotas com Permissões Específicas do Sistema IAM */}
            <Route element={<ProtectedRoute requiredPermission="system:users:read" />}>
              <Route path="/iam/users" element={<IAMUsersPage />} />
            </Route>

            <Route element={<ProtectedRoute requiredPermission="system:roles:read" />}>
              <Route path="/iam/roles" element={<IAMRolesPage />} />
            </Route>
          </Route>
        </Route>

        {/* Rota Fallback */}
        <Route path="*" element={<Navigate to="/workspaces" replace />} />
      </Routes>

      {/* Toaster Oficial Base UI shadcn */}
      <Toaster />
    </TooltipProvider>
  );
};
