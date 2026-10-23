import { z } from "zod";
import type { AuditLog } from "../audit/audit-log.js";

export const CLOSING_PERIOD_PLUGIN = "closing_period";
export const CLOSING_PERIOD_TARGET = "closing_period";

const Range = z.object({ startDate: z.string(), endDate: z.string() });
const Base = z.object({ name: z.string() });
const WithRange = Base.merge(Range);

/** Declara no Audit Log o schema de atributos de cada ação do Plugin (ADR 0001). */
export function declareClosingPeriodAudit(auditLog: AuditLog): void {
  const declare = <S extends z.ZodTypeAny>(action: string, schema: S, summary: (a: z.infer<S>) => string): void =>
    auditLog.declareAction({ plugin: CLOSING_PERIOD_PLUGIN, action, schemaVersion: 1, schema, summary });

  declare("create", WithRange, (a) => `Criou o período "${a.name}" (${a.startDate} a ${a.endDate}).`);
  declare(
    "update_range",
    Base.extend({ from: Range, to: Range }),
    (a) => `Alterou a faixa do período "${a.name}" de ${a.from.startDate}–${a.from.endDate} para ${a.to.startDate}–${a.to.endDate}.`,
  );
  declare("close", WithRange, (a) => `Fechou o período "${a.name}" (${a.startDate} a ${a.endDate}).`);
  declare("reopen", WithRange, (a) => `Reabriu o período "${a.name}" (${a.startDate} a ${a.endDate}).`);
  declare("cancel", WithRange, (a) => `Cancelou o período "${a.name}" (${a.startDate} a ${a.endDate}).`);
}
