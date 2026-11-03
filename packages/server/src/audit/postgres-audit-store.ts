import { and, asc, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { auditLogEntries } from "./schema.js";
import type { AuditFacets, AuditFilter, AuditStore, LogEntry } from "./audit-store.js";

export class PostgresAuditStore implements AuditStore {
  constructor(private db: NodePgDatabase) {}

  async append(entry: LogEntry): Promise<void> {
    await this.db.insert(auditLogEntries).values(entry);
  }

  async list(filter: AuditFilter): Promise<LogEntry[]> {
    const conditions: SQL[] = [];
    if (filter.targetType !== undefined) conditions.push(eq(auditLogEntries.targetType, filter.targetType));
    if (filter.targetId !== undefined) conditions.push(eq(auditLogEntries.targetId, filter.targetId));
    if (filter.actorId !== undefined) conditions.push(eq(auditLogEntries.actorId, filter.actorId));
    if (filter.plugin !== undefined) conditions.push(eq(auditLogEntries.plugin, filter.plugin));
    if (filter.from !== undefined) conditions.push(gte(auditLogEntries.occurredAt, filter.from));
    if (filter.to !== undefined) conditions.push(lte(auditLogEntries.occurredAt, filter.to));
    const query = this.db
      .select()
      .from(auditLogEntries)
      .where(and(...conditions))
      .orderBy(desc(auditLogEntries.occurredAt));
    return filter.limit ? query.limit(filter.limit) : query;
  }

  async facets(): Promise<AuditFacets> {
    const t = auditLogEntries;
    // DISTINCT ON fica com a primeira linha de cada actorId na ordem pedida: a mais recente, com o nome atual.
    const latest = this.db
      .selectDistinctOn([t.actorId], { id: t.actorId, name: t.actorName })
      .from(t)
      .orderBy(t.actorId, desc(t.occurredAt))
      .as("latest");
    const [actors, plugins] = await Promise.all([
      this.db.select().from(latest).orderBy(asc(latest.name)),
      this.db.selectDistinct({ plugin: t.plugin }).from(t).orderBy(asc(t.plugin)),
    ]);
    return { actors, plugins: plugins.map((p) => p.plugin) };
  }
}
