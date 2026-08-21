import type { Context, MiddlewareHandler } from "hono";
import type { TokenService } from "./token-service.js";
import type { JWTAccessPayload } from "@platform/shared";

// Estende as variáveis de contexto do Hono
declare module "hono" {
  interface ContextVariableMap {
    user: JWTAccessPayload;
  }
}

export function createAuthMiddleware(tokenService: TokenService): MiddlewareHandler {
  return async (c: Context, next) => {
    const authHeader = c.req.header("Authorization");
    let token: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else {
      // Suporte a cookie access_token caso enviado
      token = c.req.header("Cookie")
        ?.split("; ")
        .find((row) => row.startsWith("access_token="))
        ?.split("=")[1];
    }

    if (!token) {
      return c.json({ error: "Não autenticado: token de acesso não fornecido." }, 401);
    }

    try {
      const payload = await tokenService.verifyAccessToken(token);
      c.set("user", payload);
      await next();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Token expirado ou inválido.";
      return c.json({ error: `Falha na autenticação: ${msg}` }, 401);
    }
  };
}

export function requirePermission(...requiredPermissions: string[]): MiddlewareHandler {
  return async (c: Context, next) => {
    const user = c.get("user") as JWTAccessPayload | undefined;
    if (!user) {
      return c.json({ error: "Acesso negado: usuário não autenticado." }, 401);
    }

    const userPerms = new Set(user.permissions || []);
    // Usuário precisa ter ao menos uma das permissões exigidas
    const hasPermission = requiredPermissions.some((perm) => userPerms.has(perm));

    if (!hasPermission) {
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
