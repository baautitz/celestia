import { sign, verify } from "hono/jwt";
import type { JWTAccessPayload, JWTRefreshPayload, User, Role } from "@platform/shared";
import { randomBytes, randomUUID } from "node:crypto";

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
  accessTtlSeconds?: number;  // Default: 300 (5 min)
  refreshTtlSeconds?: number; // Default: 604800 (7 dias)
}

export class TokenService {
  private secret: string;
  private accessTtl: number;
  private refreshTtl: number;

  constructor(config?: TokenServiceConfig) {
    this.secret = resolveSecret(config?.jwtSecret);
    this.accessTtl = config?.accessTtlSeconds ?? 300; // 5 minutos
    this.refreshTtl = config?.refreshTtlSeconds ?? 7 * 24 * 3600; // 7 dias
  }

  /**
   * Gera o Access Token (JWT de 5 minutos) com todos os claims de autorização stateless.
   */
  async generateAccessToken(user: User, role?: Role): Promise<{ token: string; payload: JWTAccessPayload }> {
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
      externals: user.externals || {},
      iat: now,
      exp,
    };

    const token = await sign(payload as unknown as Record<string, unknown>, this.secret);
    return { token, payload };
  }

  /**
   * Gera o Refresh Token (JWT de 7 dias).
   */
  async generateRefreshToken(user: User): Promise<{ token: string; payload: JWTRefreshPayload }> {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.refreshTtl;

    const payload: JWTRefreshPayload = {
      sub: user.id,
      tokenId: randomUUID(),
      type: "refresh",
      iat: now,
      exp,
    };

    const token = await sign(payload as unknown as Record<string, unknown>, this.secret);
    return { token, payload };
  }

  /**
   * Valida e decodifica o Access Token.
   */
  async verifyAccessToken(token: string): Promise<JWTAccessPayload> {
    const payload = (await verify(token, this.secret, "HS256")) as unknown as JWTAccessPayload;
    if (!payload.sub || !payload.role) {
      throw new Error("Token de acesso inválido.");
    }
    return payload;
  }

  /**
   * Valida e decodifica o Refresh Token.
   */
  async verifyRefreshToken(token: string): Promise<JWTRefreshPayload> {
    const payload = (await verify(token, this.secret, "HS256")) as unknown as JWTRefreshPayload;
    if (!payload.sub || payload.type !== "refresh") {
      throw new Error("Token de renovação inválido.");
    }
    return payload;
  }
}
