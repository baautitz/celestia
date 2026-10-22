import type {
  JWTAccessPayload,
  AuthTokens,
  User,
  Role,
  PermissionCatalog,
  ErpTypeMeta,
  ErpConnection,
  ErpConnectionInput,
  ClosingPeriodRecord,
  AuditLogEntry,
  AuditLogFilter,
} from "@platform/shared";

class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  setAccessToken(token: string | null) {
    this.accessToken = token;
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

    let response = await fetch(path, {
      ...options,
      headers,
      credentials: "include",
    });

    // Interceptor: Se receber 401 e não for rota de login/refresh, tenta renovar silenciosamente
    if (response.status === 401 && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/refresh")) {
      const newToken = await this.silentRefresh();
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
      const errBody: { error?: string | { issues?: { path: (string | number)[]; message: string }[] } } =
        await response.json().catch(() => ({ error: response.statusText }));
      // Erros de validação (Zod) chegam como { error: { issues } }; senão { error: "mensagem" }.
      const detail =
        typeof errBody.error === "string"
          ? errBody.error
          : errBody.error?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(detail || `Erro HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  private async silentRefresh(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          credentials: "include",
        });

        if (!res.ok) {
          this.setAccessToken(null);
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

  // ─── AUTHENTICATION & IAM ENDPOINTS ─────────────────────────────────────
  auth = {
    login: async (username: string, password: string): Promise<AuthTokens> => {
      const tokens = await this.request<AuthTokens>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      const token = tokens.accessToken || tokens.access_token || "";
      this.setAccessToken(token);
      return {
        ...tokens,
        accessToken: token,
      };
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

    listSources: async (): Promise<{ id: string; name: string }[]> => {
      return this.request<{ id: string; name: string }[]>("/api/iam/sources");
    },

    listUsers: async (): Promise<User[]> => {
      return this.request<User[]>("/api/iam/users");
    },

    createUser: async (user: {
      fullname: string;
      username: string;
      email: string;
      password: string;
      roleId: string;
      externals?: Record<string, string | number>;
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

  // ─── ERPs (FONTES DE DADOS) ──────────────────────────────────────────────
  closingPeriods = {
    list: async (): Promise<ClosingPeriodRecord[]> => {
      return this.request<ClosingPeriodRecord[]>("/api/closing-periods");
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
  };

  erps = {
    listTypes: async (): Promise<ErpTypeMeta[]> => {
      return this.request<ErpTypeMeta[]>("/api/admin/erp-types");
    },

    list: async (): Promise<ErpConnection[]> => {
      return this.request<ErpConnection[]>("/api/admin/connections");
    },

    save: async (id: string, input: ErpConnectionInput): Promise<ErpConnection> => {
      return this.request<ErpConnection>(`/api/admin/connections/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },

    test: async (id: string): Promise<boolean> => {
      try {
        await this.request<{ ok: boolean }>(`/api/admin/connections/${id}/test`, { method: "POST" });
        return true;
      } catch {
        return false;
      }
    },

    remove: async (id: string): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>(`/api/admin/connections/${id}`, { method: "DELETE" });
    },
  };
}

export const api = new ApiClient();
