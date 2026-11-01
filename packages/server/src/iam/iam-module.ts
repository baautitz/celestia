import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { defineModule, type ModuleDef } from "@platform/core/module";
import type { JWTAccessPayload, PermissionItem, User } from "@platform/shared";
import { grantDeniedMessage, missingGrants } from "./can-grant.js";
import { IAM_PERMISSIONS } from "./iam-permissions.js";
import { getAuthenticatedUser, requirePermission } from "./middleware.js";
import { hasPermission } from "./has-permission.js";
import type { TokenService } from "./token-service.js";
import { LAST_ADMIN_MESSAGE, LastAdminError, type UserStore } from "./user-store.js";
import { CertificateAuthorityUnavailableError, DeviceNotFoundError, DeviceStillActiveError, type CertificateAuthorityClient } from "./certificate-authority-client.js";
import type { AuditLog } from "../audit/audit-log.js";
import { DEVICE_AUDIT_TARGET, IAM_AUDIT_PLUGIN, USER_AUDIT_TARGET, declareIamAudit } from "./iam-audit.js";
import { LoginRateLimiter } from "./login-rate-limiter.js";
import { PASSWORD_RULES, PasswordService, PasswordPolicySchema } from "./password-service.js";

/** Pasta de migrations do Module `iam` (schema Postgres "iam"). */
export const IAM_MIGRATIONS = { folder: resolve(import.meta.dirname, "migrations"), schema: "iam" };

export interface IamModuleDeps {
  userStore: UserStore;
  /** Permissões `system:*` de áreas ainda não modularizadas, registradas no catálogo junto das do iam. */
  extraPermissions?: readonly PermissionItem[];
  tokenService: TokenService;
  auth: MiddlewareHandler;
  withAdminBypass: (payload: JWTAccessPayload) => JWTAccessPayload;
  /** Autoridade certificadora: dona dos Dispositivos e do certificado que cada um apresenta. */
  certificateAuthority: CertificateAuthorityClient;
  auditLog: AuditLog;
  /** Limite de tentativas de login; por padrão 5 falhas por username e 20 por IP a cada 15 min. */
  loginRateLimiter?: LoginRateLimiter;
}

let dummyHash: string | undefined;
/** Hash descartável para igualar o tempo do login quando o usuário não existe. */
function getDummyHash(): string {
  dummyHash ??= PasswordService.hash(`${randomUUID()}Aa1!`);
  return dummyHash;
}

/** `Secure` em produção (HTTPS); fora dela o cookie precisa funcionar em http://localhost. */
const refreshCookie = () =>
  ({ path: "/api/auth", httpOnly: true, sameSite: "Lax", maxAge: 7 * 24 * 3600, secure: process.env.NODE_ENV === "production" }) as const;

const LAST_ADMIN = LAST_ADMIN_MESSAGE;
const ADMIN_TARGET_ONLY = "Somente administradores podem inativar outro administrador.";
const CERTIFICATE_REQUIRED = "Dispositivo não autorizado.";
const CERTIFICATE_EXEMPTION_ADMIN_ONLY = "Somente administradores podem alterar o acesso sem certificado.";
const WILDCARD_ADMIN_ONLY = "Somente administradores podem conceder acesso total (*) a um grupo de acesso.";

/**
 * Module `iam`: autenticação (/api/auth), Users e Roles (/api/iam).
 *
 * Eventos (before/after; o payload nunca carrega senha nem passwordHash):
 * iam.login, iam.user.create, iam.user.update, iam.user.delete, iam.user.reset_password,
 * iam.role.create, iam.role.update, iam.device.create, iam.device.revoke. Um `before` que cancela responde 409 com o motivo.
 */
export function createIamModule({
  userStore,
  certificateAuthority,
  auditLog,
  extraPermissions = [],
  tokenService,
  auth,
  withAdminBypass,
  loginRateLimiter = new LoginRateLimiter(),
}: IamModuleDeps): ModuleDef {
  return defineModule({
    id: "iam",
    version: "1.0.0",
    prefix: "/api",
    permissions: IAM_PERMISSIONS,
    migrations: IAM_MIGRATIONS,
    register({ routes, events, permissions, services }) {
      // Só estes campos saem para outros Modules (ADR 0002): nunca passwordHash, Role ou e-mail.
      services.expose("users", {
        list: async () => (await userStore.listUsers()).map(({ id, fullname, username, status }) => ({ id, fullname, username, status })),
      });
      declareIamAudit(auditLog);
      permissions.registerProvider(() => extraPermissions.map((p) => ({ ...p, module: p.module ?? "system" })));
      const cancelled = (c: Context, reason: string) => c.json({ error: reason }, 409);
      const P = IAM_PERMISSIONS.keys;
      const recordIamAudit = (actor: { id: string; name: string }, action: string, target: { type: string; id: string }, attributes: Record<string, unknown>, device?: { id: string; name: string }) =>
        auditLog.record({ plugin: IAM_AUDIT_PLUGIN, action, actor, target, attributes, device });
      const requestActor = (c: Context) => {
        const caller = getAuthenticatedUser(c);
        return { id: caller.sub, name: caller.fullname };
      };

      const completeLogin = async (c: Context, user: User, usedDevice?: { id: string; name: string }) => {
        loginRateLimiter.recordSuccess(user.username);
        const role = await userStore.getRole(user.roleId);
        let tokens: { accessToken: string; refreshToken: string; payload: JWTAccessPayload } | undefined;
        const ran = await events.run("iam.login", { userId: user.id, username: user.username }, async () => {
          const access = await tokenService.generateAccessToken(user, role || undefined, usedDevice);
          const refresh = await tokenService.generateRefreshToken(user, usedDevice?.id);
          tokens = { accessToken: access.token, refreshToken: refresh.token, payload: access.payload };
        });
        if (ran.cancelled) return cancelled(c, ran.reason);
        if (!tokens) return c.json({ error: "Credenciais inválidas." }, 401);
        const { accessToken, refreshToken, payload } = tokens;
        if (usedDevice) {
          await recordIamAudit({ id: user.id, name: user.fullname }, "login_with_device", { type: DEVICE_AUDIT_TARGET, id: usedDevice.id }, { username: user.username, deviceName: usedDevice.name }, usedDevice);
        }

        setCookie(c, "refresh_token", refreshToken, refreshCookie());

        return c.json({
          accessToken,
          refreshToken,
          expiresIn: 300,
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 300,
          user: withAdminBypass(payload),
        });
      };

      routes.post(
        "/auth/login",
        zValidator("json", z.object({ username: z.string(), password: z.string() })),
        async (c) => {
          const { username, password } = c.req.valid("json");
          const retryAfter = loginRateLimiter.retryAfterSeconds(username);
          if (retryAfter > 0) {
            c.header("Retry-After", String(retryAfter));
            return c.json({ error: "Muitas tentativas de login. Tente novamente mais tarde." }, 429);
          }
          const user = await userStore.findByUsername(username);

          // Mesma mensagem e mesmo custo (hash dummy) para inexistente, senha errada e inativo.
          const isPasswordValid = PasswordService.verify(password, user?.passwordHash || getDummyHash());
          if (!user || user.status === "inactive" || !isPasswordValid) {
            loginRateLimiter.recordFailure(username);
            return c.json({ error: "Credenciais inválidas." }, 401);
          }

          // Sem a opção de acesso sem certificado, o certificado de um Dispositivo ativo é obrigatório. Só se pede
          // depois da senha, para não revelar a exigência a quem não a conhece: o navegador vai à CA ler o certificado
          // e volta pelo callback, que termina o login em /auth/login/certificate.
          if (!user.allowWithoutCertificate) {
            try {
              const { verifyUrl } = await certificateAuthority.createChallenge(user.id);
              return c.json({ certificateRequired: true, verifyUrl });
            } catch (err: unknown) {
              if (err instanceof CertificateAuthorityUnavailableError) return c.json({ error: err.message }, 503);
              throw err;
            }
          }
          return completeLogin(c, user);
        },
      );

      // Segundo passo do login por certificado: troca o código que a CA devolveu ao navegador pelo Dispositivo.
      routes.post(
        "/auth/login/certificate",
        zValidator("json", z.object({ challengeId: z.string().min(1), code: z.string().optional() })),
        async (c) => {
          const { challengeId, code } = c.req.valid("json");
          let exchange: Awaited<ReturnType<CertificateAuthorityClient["exchangeChallenge"]>>;
          try {
            exchange = await certificateAuthority.exchangeChallenge({ challengeId, code });
          } catch (err: unknown) {
            if (err instanceof CertificateAuthorityUnavailableError) return c.json({ error: err.message }, 503);
            throw err;
          }
          const user = exchange.userId ? await userStore.findById(exchange.userId) : null;
          if (!exchange.granted || !user || user.status === "inactive") {
            if (user) {
              await recordIamAudit({ id: user.id, name: user.fullname }, "deny_login_without_certificate", { type: USER_AUDIT_TARGET, id: user.id }, { username: user.username });
            }
            return c.json({ error: CERTIFICATE_REQUIRED }, 403);
          }
          return completeLogin(c, user, { id: exchange.deviceId, name: exchange.deviceName });
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

            if (!user || user.status === "inactive" || (user.sessionVersion ?? 0) !== refreshPayload.ver) {
              return c.json({ error: "Usuário não encontrado ou inativo." }, 401);
            }

            // A sessão continua enquanto o Dispositivo que a abriu seguir ativo; o certificado não é pedido de novo.
            // Quem exige certificado e tem uma sessão sem Dispositivo não renova (falha fechado).
            let sessionDevice: { id: string; name: string } | undefined;
            if (refreshPayload.deviceId) {
              const device = await certificateAuthority.getDevice(refreshPayload.deviceId);
              if (!device || device.status !== "active") return c.json({ error: CERTIFICATE_REQUIRED }, 401);
              sessionDevice = { id: device.id, name: device.name };
            } else if (!user.allowWithoutCertificate) {
              return c.json({ error: CERTIFICATE_REQUIRED }, 401);
            }

            const role = await userStore.getRole(user.roleId);
            const { token: newAccessToken, payload: userPayload } = await tokenService.generateAccessToken(
              user,
              role || undefined,
              sessionDevice,
            );
            const { token: newRefreshToken } = await tokenService.generateRefreshToken(user, refreshPayload.deviceId);

            setCookie(c, "refresh_token", newRefreshToken, refreshCookie());

            return c.json({
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
              expiresIn: 300,
              access_token: newAccessToken,
              refresh_token: newRefreshToken,
              expires_in: 300,
              user: withAdminBypass(userPayload),
            });
          } catch (err: unknown) {
            // Com a CA fora do ar, quem exige certificado não renova (falha fechado), mas sem confundir com token inválido.
            if (err instanceof CertificateAuthorityUnavailableError) return c.json({ error: err.message }, 503);
            return c.json({ error: "Refresh token inválido ou expirado." }, 401);
          }
        },
      );

      routes.post("/auth/logout", async (c) => {
        const refreshToken = getCookie(c, "refresh_token");
        if (refreshToken) {
          try {
            const { sub } = await tokenService.verifyRefreshToken(refreshToken);
            await userStore.revokeSessions(sub);
          } catch {
            // Token inválido ou expirado: não há sessão a revogar; o logout segue limpando o cookie.
          }
        }
        deleteCookie(c, "refresh_token", { path: "/api/auth" });
        return c.json({ success: true, message: "Sessão encerrada com sucesso." });
      });

      routes.get("/auth/me", auth, async (c) => c.json(c.get("user")));

      // A tela mostra o que a senha já cumpre; a validação continua no servidor.
      routes.get("/iam/password-policy", auth, (c) =>
        c.json({ rules: PASSWORD_RULES.map(({ label, pattern }) => ({ label, pattern: pattern.source })) }),
      );

      // ───────── Users e Roles ─────────
      const actorOf = (c: Context): string => getAuthenticatedUser(c).sub;
      const failure = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

      // Responde 403 quando o chamador tenta conceder chaves que não possui; devolve undefined se pode.
      const grantViolation = (c: Context, targets: readonly string[]) => {
        const caller = getAuthenticatedUser(c);
        const missing = missingGrants(caller.permissions, targets, caller.isAdmin === true);
        return missing.length > 0 ? c.json({ error: grantDeniedMessage(missing) }, 403) : undefined;
      };
      const invalidKeys = (keys: string[]): string[] => {
        const valid = permissions.allKeys();
        return keys.filter((p) => p !== "*" && !valid.has(p));
      };

      routes.get("/iam/permissions/catalog", auth, requirePermission(P["roles:read"]), async (c) => {
        const grouped: Record<string, PermissionItem[]> = {};
        for (const item of permissions.catalog().flatMap((m) => m.items)) {
          const [namespace, resource] = item.key.split(":");
          // Module declarado agrupa; o namespace "system" não é um Module, então usa o recurso.
          const group = namespace === "system" ? (resource ?? "general") : (item.module ?? namespace);
          (grouped[group] ??= []).push({ ...item, module: group });
        }
        return c.json({ system: grouped });
      });

      const auditExemption = (c: Context, target: { id: string; username: string }, allowWithoutCertificate: boolean) =>
        recordIamAudit(requestActor(c), "change_certificate_exemption", { type: USER_AUDIT_TARGET, id: target.id }, { username: target.username, allowWithoutCertificate });

      // ───────── Dispositivos ─────────
      const DeviceBody = z.object({ name: z.string().trim().min(1).max(100) });
      const auditDevice = (c: Context, action: "issue_device" | "revoke_device" | "delete_device", device: { id: string; name: string }) =>
        recordIamAudit(requestActor(c), action, { type: DEVICE_AUDIT_TARGET, id: device.id }, { name: device.name });

      const unavailable = (c: Context, err: unknown) => {
        if (err instanceof CertificateAuthorityUnavailableError) return c.json({ error: err.message }, 503);
        throw err;
      };

      routes.get("/iam/devices", auth, requirePermission(P["devices:read"]), async (c) => {
        try {
          return c.json(await certificateAuthority.listDevices());
        } catch (err: unknown) {
          return unavailable(c, err);
        }
      });

      routes.post("/iam/devices", auth, requirePermission(P["devices:create"]), zValidator("json", DeviceBody), async (c) => {
        const { name } = c.req.valid("json");
        const actor = getAuthenticatedUser(c);
        try {
          // O .pfx e a senha só existem nesta resposta: a CA não guarda nada além do fingerprint e dos metadados.
          const ran = await events.run("iam.device.create", { actorId: actor.sub, name }, () =>
            certificateAuthority.issueDevice({ name, createdBy: actor.sub }),
          );
          if (ran.cancelled) return cancelled(c, ran.reason);
          await auditDevice(c, "issue_device", ran.result.device);
          return c.json(ran.result, 201);
        } catch (err: unknown) {
          return unavailable(c, err);
        }
      });

      routes.post("/iam/devices/:id/revoke", auth, requirePermission(P["devices:revoke"]), async (c) => {
        const id = c.req.param("id");
        const actor = getAuthenticatedUser(c);
        try {
          const before = await certificateAuthority.getDevice(id);
          const ran = await events.run("iam.device.revoke", { actorId: actor.sub, deviceId: id }, () => certificateAuthority.revokeDevice(id, actor.sub));
          if (ran.cancelled) return cancelled(c, ran.reason);
          // Só registra a primeira revogação; repetir o pedido não duplica a entrada.
          if (before?.status === "active") await auditDevice(c, "revoke_device", ran.result);
          return c.json(ran.result);
        } catch (err: unknown) {
          if (err instanceof DeviceNotFoundError) return c.json({ error: err.message }, 404);
          if (err instanceof CertificateAuthorityUnavailableError) return unavailable(c, err);
          return c.json({ error: failure(err, "Erro ao revogar o Dispositivo.") }, 400);
        }
      });

      // Excluir apaga o registro de um Dispositivo já revogado: só Administrador.
      routes.delete("/iam/devices/:id", auth, async (c) => {
        if (!getAuthenticatedUser(c).isAdmin) return c.json({ error: "Somente administradores podem excluir Dispositivos." }, 403);
        const id = c.req.param("id");
        try {
          const device = await certificateAuthority.getDevice(id);
          if (!device) return c.json({ error: new DeviceNotFoundError().message }, 404);
          await certificateAuthority.deleteDevice(id);
          await auditDevice(c, "delete_device", device);
          return c.json({ success: true });
        } catch (err: unknown) {
          if (err instanceof DeviceNotFoundError) return c.json({ error: err.message }, 404);
          if (err instanceof DeviceStillActiveError) return c.json({ error: err.message }, 409);
          if (err instanceof CertificateAuthorityUnavailableError) return unavailable(c, err);
          return c.json({ error: failure(err, "Erro ao excluir o Dispositivo.") }, 400);
        }
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
            email: z.string().email().optional(),
            allowWithoutCertificate: z.boolean().optional(),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json");
          if (body.allowWithoutCertificate && !getAuthenticatedUser(c).isAdmin) {
            return c.json({ error: CERTIFICATE_EXEMPTION_ADMIN_ONLY }, 403);
          }
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
            if (body.allowWithoutCertificate) await auditExemption(c, { id: ran.result.id, username: ran.result.username }, true);
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
            status: z.enum(["active", "inactive"]).optional(),
            email: z.string().email().optional(),
            isAdmin: z.boolean().optional(),
            allowWithoutCertificate: z.boolean().optional(),
          }),
        ),
        async (c) => {
          const id = c.req.param("id");
          const { isAdmin, ...body } = c.req.valid("json");
          const caller = getAuthenticatedUser(c);
          // Ativar e desativar tem permissão própria ("Inativar Usuários"), além de editar.
          if (body.status !== undefined && !hasPermission(caller.permissions, P["users:deactivate"])) {
            return c.json({ error: "Acesso negado: permissões insuficientes.", required: [P["users:deactivate"]] }, 403);
          }
          // Isentar do certificado é tão sensível quanto o flag de administrador: só administrador altera.
          if (body.allowWithoutCertificate !== undefined && !caller.isAdmin) {
            return c.json({ error: CERTIFICATE_EXEMPTION_ADMIN_ONLY }, 403);
          }
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
          if (body.roleId) {
            const targetRole = await userStore.getRole(body.roleId);
            if (targetRole) {
              const denied = grantViolation(c, targetRole.permissions);
              if (denied) return denied;
            }
          }
          const previous = await userStore.findById(id);
          try {
            const ran = await events.run(
              "iam.user.update",
              { actorId: actorOf(c), userId: id, fullname: body.fullname, roleId: body.roleId, status: body.status, isAdmin },
              () => userStore.updateUser(id, { ...body, isAdmin }),
            );
            if (ran.cancelled) return cancelled(c, ran.reason);
            if (body.allowWithoutCertificate !== undefined && body.allowWithoutCertificate !== (previous?.allowWithoutCertificate ?? false)) {
              await auditExemption(c, { id, username: ran.result.username }, body.allowWithoutCertificate);
            }
            return c.json(ran.result);
          } catch (err: unknown) {
            if (err instanceof LastAdminError) return c.json({ error: LAST_ADMIN }, 409);
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

      // Excluir é definitivo: só Administrador. Para impedir o acesso, há a inativação.
      routes.delete("/iam/users/:id", auth, async (c) => {
        const id = c.req.param("id");
        if (!getAuthenticatedUser(c).isAdmin) {
          return c.json({ error: "Somente administradores podem excluir usuários." }, 403);
        }
        if (id === getAuthenticatedUser(c).sub) {
          return c.json({ error: "Não é possível excluir a si mesmo." }, 409);
        }
        try {
          const ran = await events.run("iam.user.delete", { actorId: actorOf(c), userId: id }, () => userStore.deleteUser(id));
          if (ran.cancelled) return cancelled(c, ran.reason);
          return c.json({ success: true });
        } catch (err: unknown) {
          if (err instanceof LastAdminError) return c.json({ error: LAST_ADMIN }, 409);
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
