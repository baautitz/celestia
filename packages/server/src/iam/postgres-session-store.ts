import { eq, isNull, lte, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sessions } from "./schema.js";
import type { SessionRecord, SessionStore } from "./session-store.js";

type Row = typeof sessions.$inferSelect;

const toRecord = (row: Row): SessionRecord => ({
  tokenHash: row.tokenHash,
  userId: row.userId,
  userSessionVersion: row.userSessionVersion,
  ...(row.deviceId ? { deviceId: row.deviceId } : {}),
  familyId: row.familyId,
  issuedAt: row.issuedAt,
  expiresAt: row.expiresAt,
  ...(row.usedAt !== null ? { usedAt: row.usedAt } : {}),
  ...(row.lockedAt !== null ? { lockedAt: row.lockedAt } : {}),
});

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly db: NodePgDatabase) {}

  async insert(record: SessionRecord): Promise<void> {
    await this.db.insert(sessions).values({ ...record, deviceId: record.deviceId ?? null, usedAt: record.usedAt ?? null, lockedAt: record.lockedAt ?? null });
  }

  async find(tokenHash: string): Promise<SessionRecord | undefined> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
    return row && toRecord(row);
  }

  /** O `UPDATE ... WHERE used_at IS NULL` é o que torna a marcação atômica entre requisições simultâneas. */
  async markUsed(tokenHash: string, at: number): Promise<boolean> {
    const updated = await this.db
      .update(sessions)
      .set({ usedAt: at })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.usedAt)))
      .returning({ tokenHash: sessions.tokenHash });
    return updated.length > 0;
  }

  async lockFamily(familyId: string, at: number): Promise<void> {
    await this.db.update(sessions).set({ lockedAt: at }).where(and(eq(sessions.familyId, familyId), isNull(sessions.lockedAt)));
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.familyId, familyId));
  }

  async purgeExpired(now: number): Promise<void> {
    await this.db.delete(sessions).where(lte(sessions.expiresAt, now));
  }
}
