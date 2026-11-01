import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { AuditFilter, AuditStore, LogEntry } from "./audit-store.js";
import { currentDevice, type RequestDevice } from "./request-device.js";

export interface AuditActionDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  plugin: string;
  action: string;
  /** Versão do schema de atributos; guardada em cada entrada. */
  schemaVersion: number;
  schema: S;
  /** Resumo legível guardado na entrada, para que ela faça sentido sem o Plugin. */
  summary(attributes: z.infer<S>): string;
}

export interface RecordInput {
  plugin: string;
  action: string;
  actor: { id: string; name: string };
  target: { type: string; id: string };
  attributes: unknown;
  occurredAt?: Date;
  /** Dispositivo explícito (o do login, que ainda não tem sessão); senão, o da requisição em andamento. */
  device?: RequestDevice;
}

/** Audit Log único do sistema (ADR 0001). Plugins declaram o schema de cada ação e gravam entradas. */
export class AuditLog {
  private actions = new Map<string, AuditActionDef<z.ZodTypeAny>>();

  constructor(private readonly store: AuditStore) {}

  declareAction<S extends z.ZodTypeAny>(def: AuditActionDef<S>): void {
    const key = `${def.plugin}:${def.action}`;
    if (this.actions.has(key)) throw new Error(`Ação de auditoria "${key}" já declarada.`);
    this.actions.set(key, def);
  }

  async record(input: RecordInput): Promise<LogEntry> {
    const def = this.actions.get(`${input.plugin}:${input.action}`);
    if (!def) throw new Error(`Ação de auditoria "${input.plugin}:${input.action}" não declarada.`);
    const attributes: Record<string, unknown> = def.schema.parse(input.attributes);
    const device = input.device ?? currentDevice();
    const entry: LogEntry = {
      id: randomUUID(),
      occurredAt: input.occurredAt ?? new Date(),
      actorId: input.actor.id,
      actorName: input.actor.name,
      plugin: input.plugin,
      action: input.action,
      targetType: input.target.type,
      targetId: input.target.id,
      attributes,
      schemaVersion: def.schemaVersion,
      summary: def.summary(attributes),
      deviceId: device?.id ?? null,
      deviceName: device?.name ?? null,
    };
    await this.store.append(entry);
    return entry;
  }

  /** Leitura não depende dos schemas: funciona mesmo sem o Plugin que escreveu a entrada. */
  list(filter: AuditFilter): Promise<LogEntry[]> {
    return this.store.list(filter);
  }
}
