import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { defineModule, type ModuleDef } from "@platform/core/module";
import type { JWTAccessPayload } from "@platform/shared";
import type { TokenService } from "./token-service.js";
import type { UserStore } from "./user-store.js";
import { PasswordService } from "./password-service.js";

export interface IamModuleDeps {
  userStore: UserStore;
  tokenService: TokenService;
  auth: MiddlewareHandler;
  withAdminBypass: (payload: JWTAccessPayload) => JWTAccessPayload;
}

let dummyHash: string | undefined;
/** Hash descartável para igualar o tempo do login quando o usuário não existe. */
function getDummyHash(): string {
  dummyHash ??= PasswordService.hash(`${randomUUID()}Aa1!`);
  return dummyHash;
}

const COOKIE = { path: "/api/auth", httpOnly: true, sameSite: "Lax", maxAge: 7 * 24 * 3600 } as const;

/** Module `iam`: dono da autenticação (login, refresh, logout, me) em /api/auth. */
export function createIamModule({ userStore, tokenService, auth, withAdminBypass }: IamModuleDeps): ModuleDef {
  return defineModule({
    id: "iam",
    version: "1.0.0",
    prefix: "/api/auth",
    register({ routes }) {
      routes.post(
        "/login",
        zValidator("json", z.object({ username: z.string(), password: z.string() })),
        async (c) => {
          const { username, password } = c.req.valid("json");
          const user = await userStore.findByUsername(username);

          // Mesma mensagem e mesmo custo (hash dummy) para inexistente, senha errada e inativo.
          const isPasswordValid = PasswordService.verify(password, user?.passwordHash || getDummyHash());
          if (!user || user.status === "inactive" || !isPasswordValid) {
            return c.json({ error: "Credenciais inválidas." }, 401);
          }

          const role = await userStore.getRole(user.roleId);
          const { token: accessToken, payload } = await tokenService.generateAccessToken(user, role || undefined);
          const { token: refreshToken } = await tokenService.generateRefreshToken(user);

          setCookie(c, "refresh_token", refreshToken, COOKIE);

          return c.json({
            accessToken,
            refreshToken,
            expiresIn: 300,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: 300,
            user: withAdminBypass(payload),
          });
        },
      );

      // Silent refresh via cookie HttpOnly
      routes.post(
        "/refresh",
        zValidator("json", z.object({ refresh_token: z.string().optional() }).optional()),
        async (c) => {
          const body = c.req.valid("json");
          const refreshToken = body?.refresh_token || getCookie(c, "refresh_token");

          if (!refreshToken) {
            return c.json({ error: "Refresh token não fornecido." }, 401);
          }

          try {
            const refreshPayload = await tokenService.verifyRefreshToken(refreshToken);
            const user = await userStore.findById(refreshPayload.sub);

            if (!user || user.status === "inactive") {
              return c.json({ error: "Usuário não encontrado ou inativo." }, 401);
            }

            const role = await userStore.getRole(user.roleId);
            const { token: newAccessToken, payload: userPayload } = await tokenService.generateAccessToken(
              user,
              role || undefined,
            );
            const { token: newRefreshToken } = await tokenService.generateRefreshToken(user);

            setCookie(c, "refresh_token", newRefreshToken, COOKIE);

            return c.json({
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
              expiresIn: 300,
              access_token: newAccessToken,
              refresh_token: newRefreshToken,
              expires_in: 300,
              user: withAdminBypass(userPayload),
            });
          } catch {
            return c.json({ error: "Refresh token inválido ou expirado." }, 401);
          }
        },
      );

      routes.post("/logout", async (c) => {
        deleteCookie(c, "refresh_token", { path: "/api/auth" });
        return c.json({ success: true, message: "Sessão encerrada com sucesso." });
      });

      routes.get("/me", auth, async (c) => c.json(c.get("user")));
    },
  });
}
