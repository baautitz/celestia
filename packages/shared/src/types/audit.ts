/** Log Entry do Audit Log, como a API entrega (datas em ISO 8601). */
export interface AuditLogEntry {
  id: string;
  occurredAt: string;
  actorId: string;
  actorName: string;
  plugin: string;
  action: string;
  targetType: string;
  targetId: string;
  attributes: Record<string, unknown>;
  schemaVersion: number;
  summary: string;
  /** Dispositivo da sessão de quem agiu; nulo quando a sessão não usou certificado (e nas entradas antigas). */
  deviceId: string | null;
  deviceName: string | null;
}

export interface AuditLogFilter {
  targetType?: string;
  targetId?: string;
  actorId?: string;
  plugin?: string;
  /** Dia local YYYY-MM-DD; o cliente envia o início desse dia como instante ISO. */
  from?: string;
  /** Dia local YYYY-MM-DD, inclusivo; o cliente envia o fim desse dia como instante ISO. */
  to?: string;
}

/** Valores presentes no Audit Log, para os filtros da consulta. */
export interface AuditLogFacets {
  /** Quem já agiu, com o nome da entrada mais recente. */
  actors: { id: string; name: string }[];
  plugins: string[];
}
