import type { Context } from "hono";

/** Usuário autenticado como as rotas das Metas o leem. */
export type AuthContext = Context<{ Variables: { user?: { sub?: string; fullname?: string; permissions?: string[] } } }>;

/** Autor de uma entrada no Audit Log. */
export const ator = (c: AuthContext) => ({ id: c.get("user")?.sub ?? "", name: c.get("user")?.fullname ?? "" });
