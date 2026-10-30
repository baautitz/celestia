import { z } from "zod";
import type { AuditLog } from "../audit/audit-log.js";

export const IAM_AUDIT_PLUGIN = "iam";
export const DEVICE_AUDIT_TARGET = "device";
export const USER_AUDIT_TARGET = "user";

const Device = z.object({ name: z.string() });

/** Declara no Audit Log as ações do `iam` ligadas a Dispositivos e ao acesso sem certificado (ADR 0001). */
export function declareIamAudit(auditLog: AuditLog): void {
  const declare = <S extends z.ZodTypeAny>(action: string, schema: S, summary: (a: z.infer<S>) => string): void =>
    auditLog.declareAction({ plugin: IAM_AUDIT_PLUGIN, action, schemaVersion: 1, schema, summary });

  declare("issue_device", Device, (a) => `Emitiu o certificado do Dispositivo "${a.name}".`);
  declare("revoke_device", Device, (a) => `Revogou o Dispositivo "${a.name}".`);
  declare(
    "deny_login_without_certificate",
    z.object({ username: z.string() }),
    (a) => `Negou o login de "${a.username}": o acesso exige o certificado de um Dispositivo ativo.`,
  );
  declare(
    "change_certificate_exemption",
    z.object({ username: z.string(), allowWithoutCertificate: z.boolean() }),
    (a) => `${a.allowWithoutCertificate ? "Permitiu" : "Deixou de permitir"} o acesso sem certificado de "${a.username}".`,
  );
}
