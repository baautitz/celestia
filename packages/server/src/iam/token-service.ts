import { sign, verify } from "hono/jwt";
import type { JWTAccessPayload, JWTRefreshPayload, User, Role } from "@platform/shared";
import { randomUUID } from "node:crypto";

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
    this.secret = config?.jwtSecret || process.env.JWT_SECRET || "sdui-platform-super-secret-key-2026";
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
