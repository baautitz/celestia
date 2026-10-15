import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { allEntries, accessibleEntries } from "./modules";
import { useAuth } from "./context/AuthContext";
import { Card, CardHeader, CardTitle, CardDescription } from "@platform/ui/components/card";
import { Toaster } from "@platform/ui/components/toast";
import { TooltipProvider } from "@platform/ui/components/tooltip";

const HomeRedirect: React.FC = () => {
  const { hasPermission } = useAuth();
  const first = accessibleEntries(hasPermission)[0];
  if (first) return <Navigate to={first.path} replace />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sem acesso</CardTitle>
        <CardDescription>Seu perfil não possui permissão para acessar nenhum módulo.</CardDescription>
      </CardHeader>
    </Card>
  );
};

export const App: React.FC = () => {
  return (
    <TooltipProvider>
      <Routes>
        {/* Rota Pública de Autenticação */}
        <Route path="/login" element={<LoginPage />} />

        {/* Rotas Protegidas Autenticadas com Layout Corporativo */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<HomeRedirect />} />
            {allEntries.map((entry) => (
              <Route key={entry.id} element={<ProtectedRoute requiredPermission={entry.permission} />}>
                <Route path={entry.path} element={<entry.component />} />
              </Route>
            ))}
          </Route>
        </Route>

        {/* Rota Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Toaster Oficial Base UI shadcn */}
      <Toaster />
    </TooltipProvider>
  );
};
