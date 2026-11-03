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
  /** Dispositivo da sessão de quem agiu; nulo sem certificado e nas entradas anteriores a esta coluna. */
  deviceId: string | null;
  deviceName: string | null;
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

/** Valores presentes no Audit Log, para os filtros da consulta. */
export interface AuditFacets {
  /** Quem já agiu, com o nome da entrada mais recente, em ordem alfabética. */
  actors: { id: string; name: string }[];
  plugins: string[];
}

/** Somente acréscimo: de propósito não há como alterar nem remover uma entrada. */
export interface AuditStore {
  append(entry: LogEntry): Promise<void>;
  list(filter: AuditFilter): Promise<LogEntry[]>;
  facets(): Promise<AuditFacets>;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR");

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

  async facets(): Promise<AuditFacets> {
    const latest = new Map<string, LogEntry>();
    for (const e of this.entries) {
      const seen = latest.get(e.actorId);
      if (!seen || e.occurredAt > seen.occurredAt) latest.set(e.actorId, e);
    }
    return {
      actors: [...latest.values()].map((e) => ({ id: e.actorId, name: e.actorName })).sort(byName),
      plugins: [...new Set(this.entries.map((e) => e.plugin))].sort(),
    };
  }
}
