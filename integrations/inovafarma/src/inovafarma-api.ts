/** Raiz das rotas do Plugin InovaFarma. */
export const API = "/api/m/inovafarma";

/** Opções de `apiFetch` para enviar `body` como JSON com o `method` dado. */
export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
