import { parseApiBody, parseApiError } from "@platform/ui/lib/api";
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
  AuditLogFacets,
  AuditLogFilter,
  Device,
  IssuedDevice,
} from "@platform/shared";

export class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<string | null> | null = null;
  private sessionExpiredHandler: (() => void) | null = null;
  // Evita avisar mais de uma vez por sessão encerrada, mesmo com várias requisições falhando em sequência.
  private sessionExpiredNotified = false;

  // ─── Bloqueio por inatividade ───────────────────────────────────────────
  // Bloqueado, o access token sai da memória e nenhuma requisição sai: elas esperam a senha e depois seguem com o token novo.
  private locked = false;
  private lockWaiters: Array<(token: string | null) => void> = [];
  private lockHandler: ((locked: boolean) => void) | null = null;
  private idleSeconds: number | null = null;
  /** Quem está logado (ou bloqueado): a janela de senha mostra o nome. */
  private knownUser: { fullname: string; username: string } | null = null;
  private inFlight = 0;
  /** Avisa as outras abas do mesmo navegador: elas compartilham o cookie, logo a sessão e o bloqueio. */
  private channel: BroadcastChannel | null = null;

  constructor() {
    if (typeof BroadcastChannel === "undefined") return;
    this.channel = new BroadcastChannel("celestia-session");
    this.channel.onmessage = (event: MessageEvent<string>) => {
      if (event.data === "lock") this.enterLock(false);
      else if (event.data === "unlock") void this.unlockedElsewhere();
    };
  }

  /** Quem muda o estado de bloqueio (a UI mostra ou esconde a janela de senha). */
  onLockChange(handler: ((locked: boolean) => void) | null) {
    this.lockHandler = handler;
  }

  isLocked(): boolean {
    return this.locked;
  }

  /** Segundos de inatividade que o servidor manda bloquear; `null` antes do primeiro login. */
  getIdleSeconds(): number | null {
    return this.idleSeconds;
  }

  getKnownUser(): { fullname: string; username: string } | null {
    return this.knownUser;
  }

  /** Há requisição em andamento: o bloqueio espera ela terminar. */
  isBusy(): boolean {
    return this.inFlight > 0;
  }

  /** Bloqueia a sessão e descarta o access token da memória. */
  lock() {
    this.enterLock(true);
  }

  private enterLock(broadcast: boolean) {
    if (this.locked) return;
    this.locked = true;
    this.accessToken = null;
    this.lockHandler?.(true);
    if (!broadcast) return;
    this.channel?.postMessage("lock");
    // O servidor passa a ser a autoridade: sem o aviso, recarregar a página renovaria o token e destravaria a tela.
    // Sem rede o bloqueio local segue de pé, e o servidor ainda o impõe pelo tempo parado.
    void fetch("/api/auth/lock", { method: "POST", credentials: "include" }).catch(() => undefined);
  }

  private waitForUnlock(): Promise<string | null> {
    return new Promise((resolve) => this.lockWaiters.push(resolve));
  }

  private releaseLock(token: string | null) {
    this.locked = false;
    const waiters = this.lockWaiters;
    this.lockWaiters = [];
    for (const resolve of waiters) resolve(token);
    this.lockHandler?.(false);
  }

  /** Outra aba desbloqueou: o cookie já tem o token novo, basta renovar o access token daqui. */
  private async unlockedElsewhere() {
    if (!this.locked) return;
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as AuthTokens;
        this.acceptTokens(data);
        this.releaseLock(data.accessToken);
        return;
      }
    } catch {
      // Sem rede: continua bloqueada até a senha ser digitada aqui.
      return;
    }
    this.expireSession();
  }

  private expireSession() {
    this.setAccessToken(null);
    this.knownUser = null;
    if (this.locked) this.releaseLock(null);
    if (!this.sessionExpiredNotified) {
      this.sessionExpiredNotified = true;
      this.sessionExpiredHandler?.();
    }
  }

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
    this.inFlight += 1;
    try {
      return await this.send<T>(path, options);
    } finally {
      this.inFlight -= 1;
    }
  }

  private async send<T>(path: string, options: RequestInit): Promise<T> {
    // Bloqueada, a requisição não sai: espera a senha e segue com o token novo (ou falha se o usuário sair).
    if (this.locked && !(await this.waitForUnlock())) throw new Error("Sessão encerrada.");

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

    if (!response.ok) throw await parseApiError(response);

    return parseApiBody<T>(response);
  }

  private async silentRefresh(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      // O token de quando a renovação começou: se mudar enquanto ela espera, um login terminou no meio do caminho.
      const tokenAtStart = this.accessToken;
      // Falha de rede não prova que a sessão acabou: o erro sobe e o token fica para a próxima tentativa.
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          credentials: "include",
        });

        if (!res.ok) {
          // Sessão ociosa: pede a senha em vez de encerrar, e a requisição espera o desbloqueio.
          const refused = res.status === 401 ? ((await res.clone().json().catch(() => null)) as { code?: string; user?: { fullname: string; username: string } } | null) : null;
          if (refused?.code === "session_locked") {
            if (refused.user) this.knownUser = refused.user;
            this.enterLock(true);
            return this.waitForUnlock();
          }
          // Uma renovação recusada que chega depois de um login (ex.: a restauração da sessão ao abrir a página, sem
          // cookie) não pode apagar a sessão nova nem avisar que ela acabou.
          if (this.accessToken !== tokenAtStart) return this.accessToken;
          this.expireSession();
          return null;
        }

        const data = this.acceptTokens((await res.json()) as AuthTokens);
        return data.accessToken;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private acceptTokens(tokens: AuthTokens): AuthTokens {
    this.setAccessToken(tokens.accessToken);
    this.idleSeconds = tokens.idleSeconds ?? this.idleSeconds;
    if (tokens.user) this.knownUser = { fullname: tokens.user.fullname, username: tokens.user.username };
    return tokens;
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

    /** Desbloqueia a sessão ociosa com a senha do próprio usuário; senha errada mantém o bloqueio. */
    unlock: async (password: string): Promise<AuthTokens> => {
      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await parseApiError(res);
        // A sessão em si acabou (limite absoluto, tentativas esgotadas, revogada): volta ao login. Senha errada fica.
        if (res.status === 401 && error.message !== "Credenciais inválidas.") this.expireSession();
        throw error;
      }
      const tokens = this.acceptTokens((await res.json()) as AuthTokens);
      this.releaseLock(tokens.accessToken);
      this.channel?.postMessage("unlock");
      return tokens;
    },

    logout: async (): Promise<void> => {
      try {
        // Bloqueada a requisição esperaria a senha: o logout sai direto, pelo cookie.
        if (this.locked) await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
        else await this.request("/api/auth/logout", { method: "POST" });
      } finally {
        this.setAccessToken(null);
        if (this.locked) this.releaseLock(null);
        this.channel?.postMessage("unlock");
      }
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

    deleteDevice: async (id: string): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>(`/api/iam/devices/${id}`, { method: "DELETE" });
    },

    getPasswordPolicy: async (): Promise<{ rules: { label: string; pattern: string }[] }> => {
      return this.request("/api/iam/password-policy");
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
      const { from, to, ...rest } = filter;
      for (const [key, value] of Object.entries(rest)) if (value) params.set(key, value);
      // As datas do filtro são dias locais: "De" vale do início do dia e "Até" inclui o dia inteiro.
      if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
      if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
      return this.request<AuditLogEntry[]>(`/api/audit?${params.toString()}`);
    },
    facets: async (): Promise<AuditLogFacets> => {
      return this.request<AuditLogFacets>("/api/audit/facets");
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
