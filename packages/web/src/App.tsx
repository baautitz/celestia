import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { allEntries, accessibleEntries } from "./modules";
import type { NavEntry } from "@platform/ui/contracts/module";
import { resolveEntryScreen } from "./lib/entry-screen";
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

const EntryScreen: React.FC<{ entry: NavEntry }> = ({ entry }) => {
  const { hasPermission } = useAuth();
  const Screen = resolveEntryScreen(entry, hasPermission);
  if (!Screen) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Acesso Não Autorizado</CardTitle>
          <CardDescription>
            Seu perfil de acesso não possui a permissão necessária ({entry.permission}) para visualizar este módulo.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return <Screen />;
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
              <Route key={entry.id} path={entry.path} element={<EntryScreen entry={entry} />} />
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
