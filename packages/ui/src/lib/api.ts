/** Resposta de erro da API: quem chama decide pelo `status` ou pelo `code` sem interpretar a mensagem. */
export class ApiError extends Error {
  readonly status: number;
  /** Distingue erros de mesmo `status`, quando a rota informa. */
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type ApiFetch = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;

let globalApiFetch: ApiFetch = async <T = unknown>(path: string, options?: RequestInit): Promise<T> => {
  const res = await fetch(path, { ...options, credentials: "include" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status, data.code);
  }
  return res.json() as Promise<T>;
};

export function setApiFetch(fn: ApiFetch): void {
  globalApiFetch = fn;
}

export function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  return globalApiFetch<T>(path, options);
}
