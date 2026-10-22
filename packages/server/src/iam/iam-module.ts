import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { defineModule, type ModuleDef } from "@platform/core/module";
import type { JWTAccessPayload, PermissionItem } from "@platform/shared";
import type { ErpStore } from "../erp/erp-store.js";
import { grantDeniedMessage, missingGrants } from "./can-grant.js";
import { IAM_PERMISSIONS } from "./iam-permissions.js";
import { getAuthenticatedUser, requirePermission } from "./middleware.js";
import type { TokenService } from "./token-service.js";
import type { UserStore } from "./user-store.js";
import { PasswordService, PasswordPolicySchema } from "./password-service.js";

export interface IamModuleDeps {
  userStore: UserStore;
  /** ERPs cadastrados (GET /api/iam/erps). */
  erpStore: ErpStore;
  /** Permissões `system:*` de áreas ainda não modularizadas, registradas no catálogo junto das do iam. */
  extraPermissions?: readonly PermissionItem[];
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

const LAST_ADMIN = "O sistema precisa de ao menos um administrador ativo.";
const ADMIN_TARGET_ONLY = "Somente administradores podem excluir ou inativar outro administrador.";
const WILDCARD_ADMIN_ONLY = "Somente administradores podem conceder acesso total (*) a um grupo de acesso.";

/**
 * Module `iam`: autenticação (/api/auth), Users e Roles (/api/iam).
 *
 * Eventos (before/after; o payload nunca carrega senha nem passwordHash):
 * iam.login, iam.user.create, iam.user.update, iam.user.delete, iam.user.reset_password,
 * iam.role.create, iam.role.update. Um `before` que cancela responde 409 com o motivo.
 */
export function createIamModule({ userStore, erpStore, extraPermissions = [], tokenService, auth, withAdminBypass }: IamModuleDeps): ModuleDef {
  return defineModule({
    id: "iam",
    version: "1.0.0",
    prefix: "/api",
    permissions: IAM_PERMISSIONS,
    register({ routes, events, permissions }) {
      permissions.registerProvider(() => extraPermissions.map((p) => ({ ...p, module: p.module ?? "system" })));
      const cancelled = (c: Context, reason: string) => c.json({ error: reason }, 409);

      routes.post(
        "/auth/login",
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
          let tokens: { accessToken: string; refreshToken: string; payload: JWTAccessPayload } | undefined;
          const ran = await events.run("iam.login", { userId: user.id, username: user.username }, async () => {
            const access = await tokenService.generateAccessToken(user, role || undefined);
            const refresh = await tokenService.generateRefreshToken(user);
            tokens = { accessToken: access.token, refreshToken: refresh.token, payload: access.payload };
          });
          if (ran.cancelled) return cancelled(c, ran.reason);
          if (!tokens) return c.json({ error: "Credenciais inválidas." }, 401);
          const { accessToken, refreshToken, payload } = tokens;

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
        "/auth/refresh",
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

      routes.post("/auth/logout", async (c) => {
        deleteCookie(c, "refresh_token", { path: "/api/auth" });
        return c.json({ success: true, message: "Sessão encerrada com sucesso." });
      });

      routes.get("/auth/me", auth, async (c) => c.json(c.get("user")));

      // ───────── Users e Roles ─────────
      const P = IAM_PERMISSIONS.keys;
      const actorOf = (c: Context): string => getAuthenticatedUser(c).sub;
      const failure = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

      // Responde 403 quando o chamador tenta conceder chaves que não possui; devolve undefined se pode.
      const grantViolation = (c: Context, targets: readonly string[]) => {
        const caller = getAuthenticatedUser(c);
        const missing = missingGrants(caller.permissions, targets, caller.isAdmin === true);
        return missing.length > 0 ? c.json({ error: grantDeniedMessage(missing) }, 403) : undefined;
      };
      const isLastActiveAdmin = async (id: string): Promise<boolean> => {
        const admins = (await userStore.listUsers()).filter((u) => u.isAdmin && u.status === "active");
        return admins.length === 1 && admins[0].id === id;
      };
      const invalidKeys = (keys: string[]): string[] => {
        const valid = permissions.allKeys();
        return keys.filter((p) => p !== "*" && !valid.has(p));
      };

      routes.get("/iam/permissions/catalog", auth, requirePermission(P["roles:read"]), async (c) => {
        const grouped: Record<string, PermissionItem[]> = {};
        for (const item of permissions.catalog().flatMap((m) => m.items)) {
          (grouped[item.key.split(":")[1] ?? "general"] ??= []).push({ ...item, module: item.key.split(":")[1] ?? "general" });
        }
        return c.json({ system: grouped });
      });

      // ERPs cadastrados, para vincular identificadores do usuário; sem dados de acesso.
      routes.get("/iam/erps", auth, requirePermission(P["users:read"]), async (c) => {
        const records = await erpStore.list();
        return c.json(records.map(({ id, name }) => ({ id, name })));
      });

      routes.get("/iam/users", auth, requirePermission(P["users:read"]), async (c) => c.json(await userStore.listUsers()));

      routes.post(
        "/iam/users",
        auth,
        requirePermission(P["users:create"]),
        zValidator(
          "json",
          z.object({
            fullname: z.string().min(2),
            username: z.string().min(3),
            password: PasswordPolicySchema,
            roleId: z.string(),
            externals: z.record(z.union([z.string(), z.number()])).optional(),
            email: z.string().email().optional(),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json");
          const targetRole = await userStore.getRole(body.roleId);
          if (targetRole) {
            const denied = grantViolation(c, targetRole.permissions);
            if (denied) return denied;
          }
          try {
            const ran = await events.run(
              "iam.user.create",
              { actorId: actorOf(c), username: body.username, fullname: body.fullname, roleId: body.roleId },
              () => userStore.createUser(body),
            );
            if (ran.cancelled) return cancelled(c, ran.reason);
            return c.json(ran.result, 201);
          } catch (err: unknown) {
            return c.json({ error: failure(err, "Erro ao criar usuário.") }, 400);
          }
        },
      );

      routes.put(
        "/iam/users/:id",
        auth,
        requirePermission(P["users:update"]),
        zValidator(
          "json",
          z.object({
            fullname: z.string().optional(),
            roleId: z.string().optional(),
            externals: z.record(z.union([z.string(), z.number()])).optional(),
            status: z.enum(["active", "inactive"]).optional(),
            email: z.string().email().optional(),
            isAdmin: z.boolean().optional(),
          }),
        ),
        async (c) => {
          const id = c.req.param("id");
          const { isAdmin, ...body } = c.req.valid("json");
          const caller = getAuthenticatedUser(c);
          // Único caminho pela API para o flag de administrador: só quem já é admin altera, e ninguém se rebaixa.
          if (isAdmin !== undefined) {
            if (!caller.isAdmin) {
              return c.json({ error: "Somente administradores podem alterar o acesso de administrador." }, 403);
            }
            if (id === caller.sub && !isAdmin) {
              return c.json({ error: "Você não pode remover o seu próprio acesso de administrador." }, 400);
            }
          }
          // Só admin age sobre admin: nenhum campo de um administrador é alterável por não-admin.
          if (!caller.isAdmin && (await userStore.findById(id))?.isAdmin) {
            const message = body.status === "inactive" ? ADMIN_TARGET_ONLY : "Somente administradores podem alterar outro administrador.";
            return c.json({ error: message }, 403);
          }
          if (body.status === "inactive" && (await isLastActiveAdmin(id))) {
            return c.json({ error: LAST_ADMIN }, 409);
          }
          if (body.roleId) {
            const targetRole = await userStore.getRole(body.roleId);
            if (targetRole) {
              const denied = grantViolation(c, targetRole.permissions);
              if (denied) return denied;
            }
          }
          try {
            const ran = await events.run(
              "iam.user.update",
              { actorId: actorOf(c), userId: id, fullname: body.fullname, roleId: body.roleId, status: body.status, isAdmin },
              async () => {
                const updated = await userStore.updateUser(id, body);
                if (isAdmin !== undefined) {
                  await userStore.setAdmin(id, isAdmin);
                  updated.isAdmin = isAdmin;
                }
                return updated;
              },
            );
            if (ran.cancelled) return cancelled(c, ran.reason);
            return c.json(ran.result);
          } catch (err: unknown) {
            return c.json({ error: failure(err, "Erro ao atualizar usuário.") }, 400);
          }
        },
      );

      // A nova senha nunca entra em evento.
      routes.post(
        "/iam/users/:id/reset-password",
        auth,
        requirePermission(P["users:reset_password"]),
        zValidator("json", z.object({ newPassword: PasswordPolicySchema })),
        async (c) => {
          const id = c.req.param("id");
          const { newPassword } = c.req.valid("json");

          const target = await userStore.findById(id);
          if (target?.isAdmin && !getAuthenticatedUser(c).isAdmin) {
            return c.json({ error: "Somente administradores podem redefinir a senha de outro administrador." }, 403);
          }

          try {
            const ran = await events.run("iam.user.reset_password", { actorId: actorOf(c), userId: id }, () =>
              userStore.resetPassword(id, PasswordService.hash(newPassword)),
            );
            if (ran.cancelled) return cancelled(c, ran.reason);
            return c.json({ success: true, message: "Senha redefinida com sucesso." });
          } catch (err: unknown) {
            return c.json({ error: failure(err, "Erro ao redefinir senha.") }, 400);
          }
        },
      );

      routes.delete("/iam/users/:id", auth, requirePermission(P["users:delete"]), async (c) => {
        const id = c.req.param("id");
        if (id === getAuthenticatedUser(c).sub) {
          return c.json({ error: "Não é possível excluir a si mesmo." }, 409);
        }
        if (!getAuthenticatedUser(c).isAdmin && (await userStore.findById(id))?.isAdmin) {
          return c.json({ error: ADMIN_TARGET_ONLY }, 403);
        }
        if (await isLastActiveAdmin(id)) return c.json({ error: LAST_ADMIN }, 409);
        try {
          const ran = await events.run("iam.user.delete", { actorId: actorOf(c), userId: id }, () => userStore.deleteUser(id));
          if (ran.cancelled) return cancelled(c, ran.reason);
          return c.json({ success: true });
        } catch (err: unknown) {
          return c.json({ error: failure(err, "Erro ao excluir usuário.") }, 400);
        }
      });

      routes.get("/iam/roles", auth, requirePermission(P["roles:read"]), async (c) => c.json(await userStore.listRoles()));

      routes.post(
        "/iam/roles",
        auth,
        requirePermission(P["roles:create"]),
        zValidator(
          "json",
          z.object({
            id: z.string().min(2),
            name: z.string().min(2),
            description: z.string().optional(),
            permissions: z.array(z.string()),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json");
          if (body.permissions.includes("*") && !getAuthenticatedUser(c).isAdmin) {
            return c.json({ error: WILDCARD_ADMIN_ONLY }, 403);
          }
          const invalid = invalidKeys(body.permissions);
          if (invalid.length > 0) {
            return c.json({ error: `Permissões inválidas: ${invalid.join(", ")}` }, 400);
          }
          const denied = grantViolation(c, body.permissions);
          if (denied) return denied;

          try {
            const ran = await events.run(
              "iam.role.create",
              { actorId: actorOf(c), roleId: body.id, name: body.name, permissions: body.permissions },
              () => userStore.createRole(body),
            );
            if (ran.cancelled) return cancelled(c, ran.reason);
            return c.json(ran.result, 201);
          } catch (err: unknown) {
            return c.json({ error: failure(err, "Erro ao criar grupo.") }, 400);
          }
        },
      );

      routes.put(
        "/iam/roles/:id",
        auth,
        requirePermission(P["roles:update"]),
        zValidator(
          "json",
          z.object({
            name: z.string().optional(),
            description: z.string().optional(),
            permissions: z.array(z.string()).optional(),
          }),
        ),
        async (c) => {
          const id = c.req.param("id");
          const body = c.req.valid("json");

          // Alterar a posse do curinga "*" (conceder ou retirar) é ato de administrador.
          if (body.permissions && !getAuthenticatedUser(c).isAdmin) {
            const current = (await userStore.getRole(id))?.permissions ?? [];
            if (body.permissions.includes("*") !== current.includes("*")) {
              return c.json({ error: WILDCARD_ADMIN_ONLY }, 403);
            }
          }

          if (body.permissions) {
            const invalid = invalidKeys(body.permissions);
            if (invalid.length > 0) {
              return c.json({ error: `Permissões inválidas: ${invalid.join(", ")}` }, 400);
            }
            // Só as chaves ADICIONADAS precisam ser possuídas; remover é permitido.
            const current = (await userStore.getRole(id))?.permissions ?? [];
            const denied = grantViolation(c, body.permissions.filter((key) => !current.includes(key)));
            if (denied) return denied;
          }

          try {
            const ran = await events.run(
              "iam.role.update",
              { actorId: actorOf(c), roleId: id, name: body.name, permissions: body.permissions },
              () => userStore.updateRole(id, body),
            );
            if (ran.cancelled) return cancelled(c, ran.reason);
            return c.json(ran.result);
          } catch (err: unknown) {
            return c.json({ error: failure(err, "Erro ao atualizar grupo.") }, 400);
          }
        },
      );
    },
  });
}
