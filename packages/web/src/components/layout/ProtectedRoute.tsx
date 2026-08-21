import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";

interface ProtectedRouteProps {
  requiredPermission?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ requiredPermission }) => {
  const { isAuthenticated, isLoading, hasPermission } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 bg-background">
        <div className="flex flex-col items-center gap-4 w-full max-w-sm">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <h2 className="text-xl font-bold text-destructive">Acesso Não Autorizado</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Seu perfil de acesso não possui a permissão necessária ({requiredPermission}) para visualizar este módulo.
        </p>
      </div>
    );
  }

  return <Outlet />;
};
