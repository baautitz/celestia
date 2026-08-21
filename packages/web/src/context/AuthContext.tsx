import React, { createContext, useContext, useEffect, useState } from "react";
import type { JWTAccessPayload } from "@platform/shared";
import { api } from "@/lib/api-client";

interface AuthContextType {
  user: JWTAccessPayload | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<JWTAccessPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshUser = async () => {
    try {
      const res = await api.auth.me();
      setUser(res);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (username: string, password: string) => {
    const tokens = await api.auth.login(username, password);
    if (tokens.user) {
      setUser(tokens.user);
    } else {
      await refreshUser();
    }
  };

  const logout = async () => {
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
    }
  };

  const hasPermission = (permission: string): boolean => {
    if (!user || !user.permissions) return false;
    // Permissão universal de admin se configurada, ou correspondência exata
    return user.permissions.includes(permission) || user.permissions.includes("*");
  };

  const hasAnyPermission = (...permissions: string[]): boolean => {
    if (!user || !user.permissions) return false;
    if (user.permissions.includes("*")) return true;
    return permissions.some((p) => user.permissions.includes(p));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        hasPermission,
        hasAnyPermission,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth deve ser usado dentro de um AuthProvider");
  }
  return context;
};
