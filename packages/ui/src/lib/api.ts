export type ApiFetch = <T = unknown>(path: string, options?: RequestInit) => Promise<T>;

let globalApiFetch: ApiFetch = async <T = unknown>(path: string, options?: RequestInit): Promise<T> => {
  const res = await fetch(path, { ...options, credentials: "include" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
};

export function setApiFetch(fn: ApiFetch): void {
  globalApiFetch = fn;
}

export function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  return globalApiFetch<T>(path, options);
}
