import type { Context, MiddlewareHandler } from "hono";
import { hasPermission } from "./has-permission.js";
import type { TokenService } from "./token-service.js";
import type { JWTAccessPayload } from "@platform/shared";
import { runWithDevice } from "../audit/request-device.js";

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

    let payload: JWTAccessPayload;
    try {
      payload = await tokenService.verifyAccessToken(token);
    } catch {
      return c.json({ error: "Falha na autenticação: token expirado ou inválido." }, 401);
    }
    c.set("user", transform(payload));
    const device = payload.deviceId && payload.deviceName ? { id: payload.deviceId, name: payload.deviceName } : undefined;
    // Fora do try: um erro dos handlers seguintes não pode virar 401.
    await runWithDevice(device, next);
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

/** Só Administrador passa; `message` diz ao chamador o que ele não pode fazer. Mesmo formato de 403 do `requirePermission`. */
export function requireAdmin(message = "Acesso negado: somente administradores."): MiddlewareHandler {
  return async (c: Context, next) => {
    const user = c.get("user") as JWTAccessPayload | undefined;
    if (!user) return c.json({ error: "Acesso negado: usuário não autenticado." }, 401);
    if (!user.isAdmin) return c.json({ error: message }, 403);
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
