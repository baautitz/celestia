import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const CODE_TTL_MS = 60 * 1000;
/** Limite de desafios pendentes; passando dele, o mais antigo é descartado. */
export const MAX_PENDING_CHALLENGES = 1000;

interface Challenge {
  userId: string;
  expiresAt: number;
  deviceId?: string;
  codeHash?: Buffer;
  codeExpiresAt?: number;
}

export type ExchangeResult =
  | { granted: true; userId: string; deviceId: string }
  /** `userId` só vem quando o desafio existia (e foi consumido); desafio desconhecido ou vencido não revela nada. */
  | { granted: false; userId?: string };

const hash = (value: string): Buffer => createHash("sha256").update(value).digest();

/**
 * Desafios de login por certificado, em memória e de curta duração. Cada desafio nasce depois da senha, é ligado a
 * um usuário e só vira um código de uso único quando a leitura do certificado acha um Dispositivo ativo.
 * Qualquer tentativa de troca consome o desafio: acertar ou errar o código só dá uma chance.
 * Reiniciar a CA no meio de um login apenas obriga o usuário a tentar de novo.
 */
export class ChallengeStore {
  private challenges = new Map<string, Challenge>();

  constructor(private now: () => number = Date.now) {}

  create(userId: string): string {
    this.purgeExpired();
    if (this.challenges.size >= MAX_PENDING_CHALLENGES) {
      const oldest = this.challenges.keys().next().value;
      if (oldest !== undefined) this.challenges.delete(oldest);
    }
    const id = randomUUID();
    this.challenges.set(id, { userId, expiresAt: this.now() + CHALLENGE_TTL_MS });
    return id;
  }

  /** Liga o Dispositivo ao desafio e devolve o código de uso único; `undefined` se o desafio não existe, venceu ou já foi ligado. */
  bindDevice(challengeId: string, deviceId: string): string | undefined {
    const challenge = this.live(challengeId);
    if (!challenge || challenge.codeHash) return undefined;
    const code = randomBytes(32).toString("base64url");
    challenge.deviceId = deviceId;
    challenge.codeHash = hash(code);
    challenge.codeExpiresAt = this.now() + CODE_TTL_MS;
    return code;
  }

  exchange(challengeId: string, code: string | undefined): ExchangeResult {
    const challenge = this.live(challengeId);
    this.challenges.delete(challengeId);
    if (!challenge) return { granted: false };
    const valid =
      code !== undefined &&
      challenge.codeHash !== undefined &&
      challenge.deviceId !== undefined &&
      (challenge.codeExpiresAt ?? 0) > this.now() &&
      timingSafeEqual(hash(code), challenge.codeHash);
    return valid ? { granted: true, userId: challenge.userId, deviceId: challenge.deviceId! } : { granted: false, userId: challenge.userId };
  }

  get size(): number {
    return this.challenges.size;
  }

  private live(challengeId: string): Challenge | undefined {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) return undefined;
    if (challenge.expiresAt <= this.now()) {
      this.challenges.delete(challengeId);
      return undefined;
    }
    return challenge;
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(id);
    }
  }
}
