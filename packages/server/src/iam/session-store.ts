/** Um refresh token emitido. O banco guarda só o hash; o token em claro vive apenas no cookie do navegador. */
export interface SessionRecord {
  tokenHash: string;
  userId: string;
  /** `session_version` do Usuário na emissão: reset de senha e desativação o incrementam e derrubam a sessão. */
  userSessionVersion: number;
  deviceId?: string;
  /** Todos os tokens rotacionados de uma mesma sessão compartilham a família. */
  familyId: string;
  /** Quando este token foi emitido (a última renovação da sessão). */
  issuedAt: number;
  /** Fim absoluto da sessão, herdado pela família inteira. */
  expiresAt: number;
  /** Quando foi usado para renovar; `undefined` enquanto vale. */
  usedAt?: number;
  /** Quando a sessão foi bloqueada (cliente ocioso): não renova até a senha. Vale para a família inteira. */
  lockedAt?: number;
}

export interface SessionStore {
  insert(record: SessionRecord): Promise<void>;
  find(tokenHash: string): Promise<SessionRecord | undefined>;
  /** Marca como usado de forma atômica: `true` só para quem marcou primeiro. */
  markUsed(tokenHash: string, at: number): Promise<boolean>;
  /** Bloqueia a família: ela só volta com `unlock` (a senha). */
  lockFamily(familyId: string, at: number): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
  /** Apaga os tokens expirados (limpeza oportunista na renovação). */
  purgeExpired(now: number): Promise<void>;
}

export class MemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionRecord>();

  async insert(record: SessionRecord): Promise<void> {
    this.records.set(record.tokenHash, { ...record });
  }

  async find(tokenHash: string): Promise<SessionRecord | undefined> {
    const record = this.records.get(tokenHash);
    return record && { ...record };
  }

  async markUsed(tokenHash: string, at: number): Promise<boolean> {
    const record = this.records.get(tokenHash);
    if (!record || record.usedAt !== undefined) return false;
    record.usedAt = at;
    return true;
  }

  async lockFamily(familyId: string, at: number): Promise<void> {
    for (const record of this.records.values()) if (record.familyId === familyId) record.lockedAt ??= at;
  }

  async revokeFamily(familyId: string): Promise<void> {
    for (const [hash, record] of this.records) if (record.familyId === familyId) this.records.delete(hash);
  }

  async purgeExpired(now: number): Promise<void> {
    for (const [hash, record] of this.records) if (record.expiresAt <= now) this.records.delete(hash);
  }
}
