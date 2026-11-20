import { z } from "zod";
import type { AuditLog } from "../audit/audit-log.js";

export const ERP_PLUGIN = "erp";
export const ERP_TARGET = "erp";

/** Só metadados: nunca valores do formulário nem segredos (host, usuário e senha ficam fora do Audit Log). */
const Identity = z.object({ name: z.string(), driver: z.string() });

/** Declara no Audit Log o schema de atributos de cada ação do Plugin (ADR 0001). */
export function declareErpAudit(auditLog: AuditLog): void {
  const declare = <S extends z.ZodType<Record<string, unknown>>>(action: string, schema: S, summary: (a: z.infer<S>) => string): void =>
    auditLog.declareAction({ plugin: ERP_PLUGIN, action, schemaVersion: 1, schema, summary });

  declare(
    "save",
    Identity.extend({ created: z.boolean() }),
    (a) => `${a.created ? "Cadastrou" : "Alterou"} o ERP "${a.name}" (driver ${a.driver}).`,
  );
  declare("delete", Identity, (a) => `Removeu o ERP "${a.name}" (driver ${a.driver}).`);
  declare("test", Identity.extend({ ok: z.boolean() }), (a) => `Testou a conexão do ERP "${a.name}": ${a.ok ? "sucesso" : "falha"}.`);
}
