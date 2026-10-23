import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { erpUserExternals } from "./schema.js";
import type { ErpExternalValues, ErpExternalsStore } from "./erp-externals-store.js";

export class PostgresErpExternalsStore implements ErpExternalsStore {
  constructor(private db: NodePgDatabase) {}

  async get(userId: string, erpId: string): Promise<ErpExternalValues> {
    const [row] = await this.db
      .select()
      .from(erpUserExternals)
      .where(and(eq(erpUserExternals.userId, userId), eq(erpUserExternals.erpId, erpId)))
      .limit(1);
    return row?.values ?? {};
  }

  async save(userId: string, erpId: string, values: ErpExternalValues): Promise<void> {
    await this.db
      .insert(erpUserExternals)
      .values({ userId, erpId, values })
      .onConflictDoUpdate({ target: [erpUserExternals.userId, erpUserExternals.erpId], set: { values, updatedAt: new Date() } });
  }

  async deleteByErp(erpId: string): Promise<void> {
    await this.db.delete(erpUserExternals).where(eq(erpUserExternals.erpId, erpId));
  }
}
