import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { CenteredScreen, LoadingScreen, Stack, Text } from "@platform/ui/components/layout";

interface ProtectedRouteProps {
  requiredPermission?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ requiredPermission }) => {
  const { isAuthenticated, isLoading, hasPermission } = useAuth();

  if (isLoading) {
    return (
      <LoadingScreen />
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <CenteredScreen fullHeight={false}>
        <Stack align="center" gap="field">
          <Text as="h2" tone="destructive" weight="bold">
            Acesso Não Autorizado
          </Text>
          <Text as="p" variant="small" tone="muted">
            Seu perfil de acesso não possui a permissão necessária ({requiredPermission}) para visualizar este módulo.
          </Text>
        </Stack>
      </CenteredScreen>
    );
  }

  return <Outlet />;
};
