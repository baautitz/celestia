import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AuthTokens, JWTAccessPayload } from "@platform/shared";
import { api } from "@/lib/api-client";
import { IdleLock } from "@/lib/idle-lock";

interface AuthContextType {
  user: JWTAccessPayload | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** `certificateUrl` vem quando o usuário exige certificado: o navegador deve ir até lá para apresentá-lo. */
  login: (username: string, password: string) => Promise<{ certificateUrl?: string }>;
  /** Termina o login por certificado com o código que a autoridade certificadora devolveu ao navegador. */
  loginWithCertificate: (challengeId: string, code?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Sessão bloqueada por inatividade: só a senha a destrava. */
  locked: boolean;
  /** Quem a janela de senha mostra enquanto a sessão está bloqueada. */
  lockedUser: { fullname: string; username: string } | null;
  unlock: (password: string) => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<JWTAccessPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [locked, setLocked] = useState<boolean>(false);
  const userRef = useRef<{ fullname: string; username: string } | null>(null);
  const [lockedUser, setLockedUser] = useState<{ fullname: string; username: string } | null>(null);

  // Conta os logins concluídos: uma restauração de sessão que começou antes de um login não pode desfazê-lo ao falhar.
  const signIns = useRef(0);
  userRef.current = user;

  const refreshUser = useCallback(async () => {
    const startedAt = signIns.current;
    try {
      const res = await api.auth.me();
      if (startedAt === signIns.current) setUser(res);
    } catch {
      if (startedAt === signIns.current) setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  // O servidor recusou renovar a sessão (ex.: o Dispositivo foi revogado): sai do cliente em vez de ficar "logado" com erro.
  useEffect(() => {
    api.onSessionExpired(() => setUser(null));
    return () => api.onSessionExpired(null);
  }, []);

  useEffect(() => {
    api.onLockChange((isLocked) => {
      setLockedUser(isLocked ? (api.getKnownUser() ?? userRef.current) : null);
      setLocked(isLocked);
    });
    return () => api.onLockChange(null);
  }, []);

  // Sem ação do usuário pelo tempo que o servidor manda, bloqueia a tela e pede a senha (sem recarregar nada).
  const idleSeconds = user && !locked ? api.getIdleSeconds() : null;
  useEffect(() => {
    if (!idleSeconds) return;
    const idle = new IdleLock({ idleSeconds, onIdle: () => api.lock(), isBusy: () => api.isBusy() });
    idle.start();
    return () => idle.stop();
  }, [idleSeconds]);

  const unlock = useCallback(async (password: string) => {
    const tokens = await api.auth.unlock(password);
    setUser(tokens.user);
  }, []);

  const signIn = useCallback(
    async (tokens: AuthTokens) => {
      signIns.current += 1;
      if (tokens.user) {
        setUser(tokens.user);
      } else {
        await refreshUser();
      }
    },
    [refreshUser],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await api.auth.login(username, password);
      if ("certificateRequired" in result) return { certificateUrl: result.verifyUrl };
      await signIn(result);
      return {};
    },
    [signIn],
  );

  const loginWithCertificate = useCallback(
    async (challengeId: string, code?: string) => {
      await signIn(await api.auth.loginWithCertificate(challengeId, code));
    },
    [signIn],
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (!user?.permissions) return false;
      // Permissão universal de admin se configurada, ou correspondência exata
      return user.permissions.includes(permission) || user.permissions.includes("*");
    },
    [user],
  );

  const hasAnyPermission = useCallback(
    (...permissions: string[]): boolean => {
      if (!user?.permissions) return false;
      if (user.permissions.includes("*")) return true;
      return permissions.some((p) => user.permissions.includes(p));
    },
    [user],
  );

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      loginWithCertificate,
      logout,
      locked,
      lockedUser,
      unlock,
      hasPermission,
      hasAnyPermission,
      refreshUser,
    }),
    [user, isLoading, login, loginWithCertificate, logout, locked, lockedUser, unlock, hasPermission, hasAnyPermission, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth deve ser usado dentro de um AuthProvider");
  }
  return context;
};
