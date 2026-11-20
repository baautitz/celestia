import { sign, verify } from "hono/jwt";
import type { JWTAccessPayload, User, Role } from "@platform/shared";
import { randomBytes } from "node:crypto";

const MIN_SECRET_LENGTH = 32;
let ephemeralSecret: string | undefined;

/** Segredo JWT: explícito (>= 32 chars); sem ele, erro em produção e segredo efêmero do processo fora dela. */
function resolveSecret(explicit?: string): string {
  const secret = explicit || process.env.JWT_SECRET;
  if (secret) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`JWT_SECRET precisa ter ao menos ${MIN_SECRET_LENGTH} caracteres.`);
    }
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET não definido: obrigatório em produção.");
  }
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString("hex");
    console.warn("JWT_SECRET não definido: usando segredo efêmero deste processo (tokens não sobrevivem a reinício).");
  }
  return ephemeralSecret;
}

export interface TokenServiceConfig {
  jwtSecret?: string;
  /**
   * Default: 300 (5 min). Access tokens são stateless e NÃO são revogáveis: após logout, reset de senha,
   * desativação, exclusão ou troca de Role o access token vigente segue válido até expirar (janela máxima de
   * 5 minutos). Só os refresh tokens (opacos, ver `SessionService`) são revogados.
   */
  accessTtlSeconds?: number;
}

export class TokenService {
  private secret: string;
  private accessTtl: number;
  /** Validade do token do Desafio de Certificado: a mesma do desafio na CA. */
  static readonly LOGIN_CHALLENGE_TTL_SECONDS = 300;

  constructor(config?: TokenServiceConfig) {
    this.secret = resolveSecret(config?.jwtSecret);
    this.accessTtl = config?.accessTtlSeconds ?? 300; // 5 minutos
  }

  /** Validade do Access Token em segundos: o que o cliente recebe em `expiresIn`. */
  get accessTtlSeconds(): number {
    return this.accessTtl;
  }

  /**
   * Gera o Access Token (JWT de 5 minutos) com todos os claims de autorização stateless.
   */
  async generateAccessToken(user: User, role?: Role, device?: { id: string; name: string }): Promise<{ token: string; payload: JWTAccessPayload }> {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.accessTtl;

    const payload: JWTAccessPayload = {
      sub: user.id,
      username: user.username,
      fullname: user.fullname,
      email: user.email,
      role: user.roleId,
      permissions: role?.permissions || [],
      ...(user.isAdmin ? { isAdmin: true } : {}),
      ...(device ? { deviceId: device.id, deviceName: device.name } : {}),
      iat: now,
      exp,
    };

    const token = await sign({ ...payload }, this.secret);
    return { token, payload };
  }

  /**
   * Token do Desafio de Certificado: prende o desafio aberto depois da senha ao navegador que a digitou (vai num
   * cookie HttpOnly). Sem ele, quem visse o `challengeId` na URL da CA terminaria o login no lugar do Usuário.
   */
  async generateLoginChallengeToken(userId: string, challengeId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return sign({ sub: userId, challengeId, type: "login_challenge", iat: now, exp: now + TokenService.LOGIN_CHALLENGE_TTL_SECONDS }, this.secret);
  }

  async verifyLoginChallengeToken(token: string): Promise<{ userId: string; challengeId: string }> {
    const claims = await verify(token, this.secret, "HS256");
    if (typeof claims.sub !== "string" || !claims.sub || claims.type !== "login_challenge" || typeof claims.challengeId !== "string") {
      throw new Error("Token de desafio inválido.");
    }
    return { userId: claims.sub, challengeId: claims.challengeId };
  }

  /**
   * Valida e decodifica o Access Token.
   */
  async verifyAccessToken(token: string): Promise<JWTAccessPayload> {
    const claims = await verify(token, this.secret, "HS256");
    const { sub, role, username, fullname, email, permissions } = claims;
    if (
      typeof sub !== "string" || !sub ||
      typeof role !== "string" || !role ||
      typeof username !== "string" ||
      typeof fullname !== "string" ||
      !Array.isArray(permissions) || !permissions.every((p): p is string => typeof p === "string")
    ) {
      throw new Error("Token de acesso inválido.");
    }
    return {
      sub,
      role,
      username,
      fullname,
      email: typeof email === "string" ? email : undefined,
      permissions,
      ...(claims.isAdmin === true ? { isAdmin: true } : {}),
      ...(typeof claims.deviceId === "string" && typeof claims.deviceName === "string" ? { deviceId: claims.deviceId, deviceName: claims.deviceName } : {}),
      iat: claims.iat,
      exp: claims.exp,
    };
  }
}
