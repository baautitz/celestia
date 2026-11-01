import { ApiError } from "@platform/ui/lib/api";
import type {
  JWTAccessPayload,
  AuthTokens,
  LoginCertificateRequired,
  User,
  Role,
  PermissionCatalog,
  ClosingPeriodRecord,
  ErpDriverMeta,
  Erp,
  ErpInput,
  AuditLogEntry,
  AuditLogFilter,
  Device,
  IssuedDevice,
} from "@platform/shared";

class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<string | null> | null = null;
  private sessionExpiredHandler: (() => void) | null = null;
  // Evita avisar mais de uma vez por sessão encerrada, mesmo com várias requisições falhando em sequência.
  private sessionExpiredNotified = false;

  setAccessToken(token: string | null) {
    this.accessToken = token;
    if (token) this.sessionExpiredNotified = false;
  }

  /** Chamado quando o servidor recusa renovar a sessão (ex.: o Dispositivo foi revogado); o cliente deve sair. */
  onSessionExpired(handler: (() => void) | null) {
    this.sessionExpiredHandler = handler;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Executa requisição HTTP autenticada com suporte a renovação silenciosa de JWT (5 min).
   */
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    headers.set("Content-Type", "application/json");

    if (this.accessToken) {
      headers.set("Authorization", `Bearer ${this.accessToken}`);
    }

    const sentToken = this.accessToken;
    let response = await fetch(path, {
      ...options,
      headers,
      credentials: "include",
    });

    // Interceptor: Se receber 401 e não for rota de login/refresh, tenta renovar silenciosamente
    if (response.status === 401 && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/refresh")) {
      // Se um login terminou enquanto esta requisição estava no ar, o 401 é do token antigo: basta repetir com o novo.
      const newToken = this.accessToken && this.accessToken !== sentToken ? this.accessToken : await this.silentRefresh();
      if (newToken) {
        headers.set("Authorization", `Bearer ${newToken}`);
        response = await fetch(path, {
          ...options,
          headers,
          credentials: "include",
        });
      }
    }

    if (!response.ok) {
      const errBody: { error?: string | { issues?: { path: (string | number)[]; message: string }[] }; code?: string } =
        await response.json().catch(() => ({ error: response.statusText }));
      // Erros de validação (Zod) chegam como { error: { issues } }; senão { error: "mensagem" }.
      const detail =
        typeof errBody.error === "string"
          ? errBody.error
          : errBody.error?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ApiError(detail || `Erro HTTP ${response.status}`, response.status, errBody.code);
    }

    return response.json() as Promise<T>;
  }

  private async silentRefresh(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      // O token de quando a renovação começou: se mudar enquanto ela espera, um login terminou no meio do caminho.
      const tokenAtStart = this.accessToken;
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          credentials: "include",
        });

        if (!res.ok) {
          // Uma renovação recusada que chega depois de um login (ex.: a restauração da sessão ao abrir a página, sem
          // cookie) não pode apagar a sessão nova nem avisar que ela acabou.
          if (this.accessToken !== tokenAtStart) return this.accessToken;
          this.setAccessToken(null);
          if (!this.sessionExpiredNotified) {
            this.sessionExpiredNotified = true;
            this.sessionExpiredHandler?.();
          }
          return null;
        }

        const data = (await res.json()) as AuthTokens;
        const token = data.accessToken || data.access_token || null;
        this.setAccessToken(token);
        return token;
      } catch {
        this.setAccessToken(null);
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private acceptTokens(tokens: AuthTokens): AuthTokens {
    const token = tokens.accessToken || tokens.access_token || "";
    this.setAccessToken(token);
    return { ...tokens, accessToken: token };
  }

  // ─── AUTHENTICATION & IAM ENDPOINTS ─────────────────────────────────────
  auth = {
    /** Quem exige certificado recebe o endereço da autoridade certificadora em vez dos tokens. */
    login: async (username: string, password: string): Promise<AuthTokens | LoginCertificateRequired> => {
      const result = await this.request<AuthTokens | LoginCertificateRequired>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if ("certificateRequired" in result) return result;
      return this.acceptTokens(result);
    },

    /** Segundo passo do login por certificado: troca o código que a autoridade devolveu ao navegador. */
    loginWithCertificate: async (challengeId: string, code?: string): Promise<AuthTokens> => {
      const tokens = await this.request<AuthTokens>("/api/auth/login/certificate", {
        method: "POST",
        body: JSON.stringify({ challengeId, code }),
      });
      return this.acceptTokens(tokens);
    },

    me: async (): Promise<JWTAccessPayload> => {
      return this.request<JWTAccessPayload>("/api/auth/me");
    },

    logout: async (): Promise<void> => {
      await this.request("/api/auth/logout", { method: "POST" });
      this.setAccessToken(null);
    },
  };

  iam = {
    getCatalog: async (): Promise<PermissionCatalog> => {
      return this.request<PermissionCatalog>("/api/iam/permissions/catalog");
    },

    listUsers: async (): Promise<User[]> => {
      return this.request<User[]>("/api/iam/users");
    },

    createUser: async (user: {
      fullname: string;
      username: string;
      email?: string;
      password: string;
      roleId: string;
      allowWithoutCertificate?: boolean;
    }): Promise<User> => {
      return this.request<User>("/api/iam/users", {
        method: "POST",
        body: JSON.stringify(user),
      });
    },

    updateUser: async (id: string, updates: Partial<User>): Promise<User> => {
      return this.request<User>(`/api/iam/users/${id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });
    },

    resetPassword: async (id: string, password: string): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>(`/api/iam/users/${id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword: password }),
      });
    },

    deleteUser: async (id: string): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>(`/api/iam/users/${id}`, {
        method: "DELETE",
      });
    },

    listDevices: async (): Promise<Device[]> => {
      return this.request<Device[]>("/api/iam/devices");
    },

    issueDevice: async (input: { name: string }): Promise<IssuedDevice> => {
      return this.request<IssuedDevice>("/api/iam/devices", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    revokeDevice: async (id: string): Promise<Device> => {
      return this.request<Device>(`/api/iam/devices/${id}/revoke`, { method: "POST" });
    },

    listRoles: async (): Promise<Role[]> => {
      return this.request<Role[]>("/api/iam/roles");
    },

    createRole: async (role: { id: string; name: string; description?: string; permissions: string[] }): Promise<Role> => {
      return this.request<Role>("/api/iam/roles", {
        method: "POST",
        body: JSON.stringify(role),
      });
    },

    updateRole: async (id: string, updates: Partial<Role>): Promise<Role> => {
      return this.request<Role>(`/api/iam/roles/${id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });
    },
  };

  // ─── AUDIT LOG ───────────────────────────────────────────────────────────
  audit = {
    list: async (filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
      return this.request<AuditLogEntry[]>(`/api/audit?${params.toString()}`);
    },
  };

  closingPeriods = {
    list: async (): Promise<ClosingPeriodRecord[]> => {
      return this.request<ClosingPeriodRecord[]>("/api/closing-periods");
    },
    create: async (data: { name: string; startDate: string; endDate: string }): Promise<ClosingPeriodRecord> => {
      return this.request<ClosingPeriodRecord>("/api/closing-periods", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    close: async (id: string): Promise<ClosingPeriodRecord> => {
      return this.request<ClosingPeriodRecord>(`/api/closing-periods/${id}/close`, { method: "POST" });
    },
    reopen: async (id: string): Promise<ClosingPeriodRecord> => {
      return this.request<ClosingPeriodRecord>(`/api/closing-periods/${id}/reopen`, { method: "POST" });
    },
    cancel: async (id: string): Promise<void> => {
      await this.request<{ success: true }>(`/api/closing-periods/${id}`, { method: "DELETE" });
    },

    updateRange: async (
      id: string,
      data: { startDate: string; endDate: string; version: number },
    ): Promise<ClosingPeriodRecord> => {
      return this.request<ClosingPeriodRecord>(`/api/closing-periods/${id}/range`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
  };

  // ─── ERPs ────────────────────────────────────────────────────────────────
  erps = {
    listDrivers: async (): Promise<ErpDriverMeta[]> => {
      return this.request<ErpDriverMeta[]>("/api/admin/erp-drivers");
    },

    list: async (): Promise<Erp[]> => {
      return this.request<Erp[]>("/api/admin/erps");
    },

    save: async (id: string, input: ErpInput): Promise<Erp> => {
      return this.request<Erp>(`/api/admin/erps/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },

    test: async (id: string): Promise<boolean> => {
      try {
        await this.request<{ ok: boolean }>(`/api/admin/erps/${id}/test`, { method: "POST" });
        return true;
      } catch {
        return false;
      }
    },

    remove: async (id: string): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>(`/api/admin/erps/${id}`, { method: "DELETE" });
    },
  };
}

export const api = new ApiClient();
