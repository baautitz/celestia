import type {
  JWTAccessPayload,
  AuthTokens,
  User,
  Role,
  PermissionCatalog,
  DashboardSchemaResponse,
  ComponentDataResponse,
  ActionExecRequest,
  ActionExecResponse,
  PersistenceSetRequest,
  PersistenceSetResponse,
  RecipeSummary,
  WorkspaceRecord,
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
      const errBody = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errBody.error || `Erro HTTP ${response.status}`);
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
        body: JSON.stringify({ password }),
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

  // ─── SDUI & WORKSPACE ENDPOINTS ─────────────────────────────────────────
  recipes = {
    list: async (): Promise<RecipeSummary[]> => {
      return this.request<RecipeSummary[]>("/api/recipes");
    },
  };

  lookups = {
    fetch: async (recipeId: string, field: string): Promise<Array<{ value: string | number; label: string }>> => {
      const searchParams = new URLSearchParams({ recipe_id: recipeId, field });
      return this.request(`/api/lookups?${searchParams.toString()}`);
    },
  };

  dashboards = {
    getSchema: async (recipeId: string = "fechamento_mes"): Promise<DashboardSchemaResponse> => {
      return this.request<DashboardSchemaResponse>(`/api/dashboards/${recipeId}/schema`);
    },
  };

  workspaces = {
    getData: async (
      workspaceId: string,
      componentId: string,
      params: {
        recipe_id?: string;
        start_date: string;
        end_date: string;
        page?: number;
        page_size?: number;
        sort_by?: string;
        order?: "asc" | "desc";
        search?: string;
      }
    ): Promise<ComponentDataResponse> => {
      const searchParams = new URLSearchParams();
      searchParams.set("recipe_id", params.recipe_id || "fechamento_mes");
      searchParams.set("start_date", params.start_date);
      searchParams.set("end_date", params.end_date);
      if (params.page) searchParams.set("page", String(params.page));
      if (params.page_size) searchParams.set("page_size", String(params.page_size));
      if (params.sort_by) searchParams.set("sort_by", params.sort_by);
      if (params.order) searchParams.set("order", params.order);
      if (params.search) searchParams.set("search", params.search);

      return this.request<ComponentDataResponse>(
        `/api/workspaces/${workspaceId}/data/${componentId}?${searchParams.toString()}`
      );
    },

    execAction: async (
      workspaceId: string,
      payload: ActionExecRequest
    ): Promise<ActionExecResponse> => {
      return this.request<ActionExecResponse>(`/api/workspaces/${workspaceId}/actions/exec`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    setPersistence: async (
      workspaceId: string,
      payload: PersistenceSetRequest
    ): Promise<PersistenceSetResponse> => {
      return this.request<PersistenceSetResponse>(`/api/workspaces/${workspaceId}/persistence/set`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    list: async (recipeId?: string): Promise<WorkspaceRecord[]> => {
      const searchParams = new URLSearchParams();
      if (recipeId) searchParams.set("recipe_id", recipeId);
      const query = searchParams.toString();
      return this.request<WorkspaceRecord[]>(`/api/workspaces${query ? `?${query}` : ""}`);
    },

    get: async (id: string): Promise<WorkspaceRecord> => {
      return this.request<WorkspaceRecord>(`/api/workspaces/${id}`);
    },

    create: async (payload: {
      name?: string;
      recipeId: string;
      startDate: string;
      endDate: string;
      params?: Record<string, unknown>;
    }): Promise<WorkspaceRecord> => {
      return this.request<WorkspaceRecord>(`/api/workspaces`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    update: async (
      id: string,
      payload: {
        name?: string;
        startDate?: string;
        endDate?: string;
        params?: Record<string, unknown>;
      }
    ): Promise<WorkspaceRecord> => {
      return this.request<WorkspaceRecord>(`/api/workspaces/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },

    conclude: async (id: string): Promise<{ success: boolean; workspace: WorkspaceRecord }> => {
      return this.request(`/api/workspaces/${id}/conclude`, {
        method: "POST",
      });
    },

    reopen: async (id: string): Promise<{ success: boolean; workspace: WorkspaceRecord }> => {
      return this.request(`/api/workspaces/${id}/reopen`, {
        method: "POST",
      });
    },

    remove: async (id: string): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>(`/api/workspaces/${id}`, {
        method: "DELETE",
      });
    },

    getCollection: async (
      workspaceId: string,
      collection: string,
      foreignKeyValue: string | number
    ): Promise<Array<Record<string, unknown>>> => {
      return this.request<Array<Record<string, unknown>>>(
        `/api/workspaces/${workspaceId}/persistence/collection/${collection}/${foreignKeyValue}`
      );
    },
  };
}

export const api = new ApiClient();
