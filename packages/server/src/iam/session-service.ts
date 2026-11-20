import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SessionPolicy } from "./session-policy.js";
import type { SessionRecord, SessionStore } from "./session-store.js";

const hashOf = (token: string): string => createHash("sha256").update(token).digest("hex");

export interface IssuedSession {
  /** Token opaco em claro, para o cookie. */
  token: string;
  record: SessionRecord;
}

export type CheckResult =
  | { ok: true; record: SessionRecord }
  /**
   * `reuse`: token já usado fora da janela (a família foi revogada). `locked`: o cliente avisou que ficou ocioso, ou a
   * sessão ficou parada além do limite; segue viva, bloqueada, e só a senha a destrava (`allowLocked`).
   */
  | { ok: false; reason: "unknown" | "expired" }
  /** Reuso: leva o registro para o servidor auditar de quem era a sessão derrubada. */
  | { ok: false; reason: "reuse"; record: SessionRecord }
  /** Bloqueada: leva o registro para o servidor dizer a quem pertence (a janela de senha mostra o nome). */
  | { ok: false; reason: "locked"; record: SessionRecord };

/** Refresh tokens opacos com rotação a cada uso e detecção de reuso. */
export class SessionService {
  constructor(
    private readonly store: SessionStore,
    private readonly policy: SessionPolicy,
    private readonly now: () => number = Date.now,
  ) {}

  get idleSeconds(): number {
    return this.policy.idleSeconds;
  }

  private async mint(userId: string, userSessionVersion: number, deviceId: string | undefined, familyId: string, expiresAt: number): Promise<IssuedSession> {
    const token = randomBytes(32).toString("base64url");
    const record: SessionRecord = { tokenHash: hashOf(token), userId, userSessionVersion, familyId, issuedAt: this.now(), expiresAt, ...(deviceId ? { deviceId } : {}) };
    await this.store.insert(record);
    return { token, record };
  }

  /** Abre uma sessão nova (login): família nova com o limite absoluto a partir de agora. */
  open(user: { id: string; sessionVersion?: number }, deviceId?: string): Promise<IssuedSession> {
    return this.mint(user.id, user.sessionVersion ?? 0, deviceId, randomUUID(), this.now() + this.policy.absoluteSeconds * 1000);
  }

  /**
   * Confere o token sem consumi-lo (uma falha transitória adiante, como a CA fora do ar, não pode gastá-lo).
   * Token já usado fora da janela de tolerância revoga a família inteira: dono e ladrão saem.
   */
  async check(token: string, options: { allowLocked?: boolean } = {}): Promise<CheckResult> {
    const now = this.now();
    await this.store.purgeExpired(now);
    const record = await this.store.find(hashOf(token));
    if (!record) return { ok: false, reason: "unknown" };
    if (record.expiresAt <= now) return { ok: false, reason: "expired" };
    if (record.usedAt !== undefined && now - record.usedAt > this.policy.reuseGraceSeconds * 1000) {
      await this.store.revokeFamily(record.familyId);
      return { ok: false, reason: "reuse", record };
    }
    if (!options.allowLocked && (record.lockedAt !== undefined || (record.usedAt === undefined && now - record.issuedAt > this.policy.idleSeconds * 1000))) {
      return { ok: false, reason: "locked", record };
    }
    return { ok: true, record };
  }

  /** Marca o token conferido como usado e emite o próximo da mesma família (`deviceId` é o da sessão daqui em diante). */
  async next(record: SessionRecord, deviceId: string | undefined): Promise<IssuedSession> {
    await this.store.markUsed(record.tokenHash, this.now());
    return this.mint(record.userId, record.userSessionVersion, deviceId, record.familyId, record.expiresAt);
  }

  /** Bloqueia a sessão do token (o cliente ficou ocioso): ela só renova de novo com a senha. */
  async lock(token: string): Promise<SessionRecord | undefined> {
    const checked = await this.check(token, { allowLocked: true });
    if (!checked.ok) return undefined;
    await this.store.lockFamily(checked.record.familyId, this.now());
    return checked.record;
  }

  /** Revoga só a sessão do token (logout). Token desconhecido não é erro. */
  async revoke(token: string): Promise<SessionRecord | undefined> {
    const record = await this.store.find(hashOf(token));
    if (record) await this.store.revokeFamily(record.familyId);
    return record;
  }
}
