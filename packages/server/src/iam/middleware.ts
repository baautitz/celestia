import type { Context, MiddlewareHandler } from "hono";
import { hasPermission } from "./has-permission.js";
import type { TokenService } from "./token-service.js";
import type { JWTAccessPayload } from "@platform/shared";

// Estende as variáveis de contexto do Hono
declare module "hono" {
  interface ContextVariableMap {
    user: JWTAccessPayload;
  }
}

export function createAuthMiddleware(
  tokenService: TokenService,
  transform: (payload: JWTAccessPayload) => JWTAccessPayload = (payload) => payload
): MiddlewareHandler {
  return async (c: Context, next) => {
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;

    if (!token) {
      return c.json({ error: "Não autenticado: token de acesso não fornecido." }, 401);
    }

    try {
      const payload = await tokenService.verifyAccessToken(token);
      c.set("user", transform(payload));
      await next();
    } catch {
      return c.json({ error: "Falha na autenticação: token expirado ou inválido." }, 401);
    }
  };
}

export function requirePermission(...requiredPermissions: string[]): MiddlewareHandler {
  return async (c: Context, next) => {
    const user = c.get("user") as JWTAccessPayload | undefined;
    if (!user) {
      return c.json({ error: "Acesso negado: usuário não autenticado." }, 401);
    }

    // Usuário precisa ter ao menos uma das permissões exigidas ("*" honrado, falha fechado)
    if (!requiredPermissions.some((perm) => hasPermission(user.permissions, perm))) {
      return c.json(
        {
          error: "Acesso negado: permissões insuficientes.",
          required: requiredPermissions,
        },
        403
      );
    }

    await next();
  };
}

export function getAuthenticatedUser(c: Context): JWTAccessPayload {
  const user = c.get("user");
  if (!user) {
    throw new Error("Usuário não autenticado no contexto da requisição.");
  }
  return user;
}
