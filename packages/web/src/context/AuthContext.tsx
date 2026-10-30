import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { AuthTokens, JWTAccessPayload } from "@platform/shared";
import { api } from "@/lib/api-client";

interface AuthContextType {
  user: JWTAccessPayload | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** `certificateUrl` vem quando o usuário exige certificado: o navegador deve ir até lá para apresentá-lo. */
  login: (username: string, password: string) => Promise<{ certificateUrl?: string }>;
  /** Termina o login por certificado com o código que a autoridade certificadora devolveu ao navegador. */
  loginWithCertificate: (challengeId: string, code?: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<JWTAccessPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Conta os logins concluídos: uma restauração de sessão que começou antes de um login não pode desfazê-lo ao falhar.
  const signIns = useRef(0);

  const refreshUser = async () => {
    const startedAt = signIns.current;
    try {
      const res = await api.auth.me();
      if (startedAt === signIns.current) setUser(res);
    } catch {
      if (startedAt === signIns.current) setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  // O servidor recusou renovar a sessão (ex.: o Dispositivo foi revogado): sai do cliente em vez de ficar "logado" com erro.
  useEffect(() => {
    api.onSessionExpired(() => setUser(null));
    return () => api.onSessionExpired(null);
  }, []);

  const signIn = async (tokens: AuthTokens) => {
    signIns.current += 1;
    if (tokens.user) {
      setUser(tokens.user);
    } else {
      await refreshUser();
    }
  };

  const login = async (username: string, password: string) => {
    const result = await api.auth.login(username, password);
    if ("certificateRequired" in result) return { certificateUrl: result.verifyUrl };
    await signIn(result);
    return {};
  };

  const loginWithCertificate = async (challengeId: string, code?: string) => {
    await signIn(await api.auth.loginWithCertificate(challengeId, code));
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
        loginWithCertificate,
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
