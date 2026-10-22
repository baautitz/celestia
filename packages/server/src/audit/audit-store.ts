export interface LogEntry {
  id: string;
  occurredAt: Date;
  /** Id de quem agiu e o nome naquele momento: o autor segue identificável após a desativação do User. */
  actorId: string;
  actorName: string;
  plugin: string;
  action: string;
  targetType: string;
  targetId: string;
  attributes: Record<string, unknown>;
  schemaVersion: number;
  summary: string;
}

export interface AuditFilter {
  targetType?: string;
  targetId?: string;
  actorId?: string;
  plugin?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

/** Somente acréscimo: de propósito não há como alterar nem remover uma entrada. */
export interface AuditStore {
  append(entry: LogEntry): Promise<void>;
  list(filter: AuditFilter): Promise<LogEntry[]>;
}

export function matchesFilter(e: LogEntry, f: AuditFilter): boolean {
  return (
    (f.targetType === undefined || e.targetType === f.targetType) &&
    (f.targetId === undefined || e.targetId === f.targetId) &&
    (f.actorId === undefined || e.actorId === f.actorId) &&
    (f.plugin === undefined || e.plugin === f.plugin) &&
    (f.from === undefined || e.occurredAt >= f.from) &&
    (f.to === undefined || e.occurredAt <= f.to)
  );
}

export class MemoryAuditStore implements AuditStore {
  private entries: LogEntry[] = [];

  async append(entry: LogEntry): Promise<void> {
    this.entries.push(structuredClone(entry));
  }

  async list(filter: AuditFilter): Promise<LogEntry[]> {
    const rows = this.entries
      .filter((e) => matchesFilter(e, filter))
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return structuredClone(filter.limit ? rows.slice(0, filter.limit) : rows);
  }
}
