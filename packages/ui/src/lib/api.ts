import type { ValidationErrorBody } from "@platform/shared";

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

type ErrorBody = ValidationErrorBody | { error?: string; code?: string };

/**
 * Converte uma resposta de erro da API em `ApiError`. A recusa de validação chega como `ValidationErrorBody`
 * (`error.issues[]`); qualquer outra falha como `{ error: "mensagem" }`. Sem corpo legível, usa o texto do status.
 */
export async function parseApiError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const errBody = typeof body === "object" && body !== null ? (body as ErrorBody) : {};
  const error = errBody.error;
  let detail: string | undefined;
  if (typeof error === "string") detail = error;
  else if (error && Array.isArray(error.issues)) detail = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  const code = "code" in errBody ? errBody.code : undefined;
  return new ApiError(detail || response.statusText || `Erro HTTP ${response.status}`, response.status, code);
}

/** Lê o corpo JSON de uma resposta de sucesso; 204 ou corpo vazio resultam em `undefined`. */
export async function parseApiBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

let globalApiFetch: ApiFetch = async <T = unknown>(path: string, options?: RequestInit): Promise<T> => {
  const res = await fetch(path, { ...options, credentials: "include" });
  if (!res.ok) throw await parseApiError(res);
  return parseApiBody<T>(res);
};

export function setApiFetch(fn: ApiFetch): void {
  globalApiFetch = fn;
}

export function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  return globalApiFetch<T>(path, options);
}
