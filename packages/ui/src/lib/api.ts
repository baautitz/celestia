/** Resposta de erro da API: quem chama decide pelo `status` sem interpretar a mensagem. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type ApiFetch = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;

let globalApiFetch: ApiFetch = async <T = unknown>(path: string, options?: RequestInit): Promise<T> => {
  const res = await fetch(path, { ...options, credentials: "include" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
};

export function setApiFetch(fn: ApiFetch): void {
  globalApiFetch = fn;
}

export function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  return globalApiFetch<T>(path, options);
}
