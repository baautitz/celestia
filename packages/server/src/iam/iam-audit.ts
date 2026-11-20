import { z } from "zod";
import type { AuditLog } from "../audit/audit-log.js";

export const IAM_AUDIT_PLUGIN = "iam";
export const DEVICE_AUDIT_TARGET = "device";
export const USER_AUDIT_TARGET = "user";
export const ROLE_AUDIT_TARGET = "role";

const Device = z.object({ name: z.string() });

/** Nomes dos campos alterados; nunca valores (senhas e hashes não entram no Audit Log). */
const ChangedFields = z.array(z.string());

/** Declara no Audit Log as ações do `iam`: Users, Roles, Dispositivos e acesso sem certificado (ADR 0001). */
export function declareIamAudit(auditLog: AuditLog): void {
  const declare = <S extends z.ZodType<Record<string, unknown>>>(action: string, schema: S, summary: (a: z.infer<S>) => string): void =>
    auditLog.declareAction({ plugin: IAM_AUDIT_PLUGIN, action, schemaVersion: 1, schema, summary });

  declare(
    "create_user",
    z.object({ username: z.string(), fullname: z.string(), roleId: z.string() }),
    (a) => `Criou o usuário "${a.username}" (${a.fullname}) no grupo "${a.roleId}".`,
  );
  declare("update_user", z.object({ username: z.string(), fields: ChangedFields }), (a) => `Alterou o usuário "${a.username}": ${a.fields.join(", ")}.`);
  declare("deactivate_user", z.object({ username: z.string() }), (a) => `Inativou o usuário "${a.username}".`);
  declare("delete_user", z.object({ username: z.string() }), (a) => `Excluiu o usuário "${a.username}".`);
  declare("reset_password", z.object({ username: z.string() }), (a) => `Redefiniu a senha do usuário "${a.username}".`);
  declare(
    "create_role",
    z.object({ name: z.string(), permissions: z.array(z.string()) }),
    (a) => `Criou o grupo de acesso "${a.name}" com ${a.permissions.length} permissões.`,
  );
  declare(
    "update_role",
    z.object({ name: z.string(), fields: ChangedFields, addedPermissions: z.array(z.string()), removedPermissions: z.array(z.string()) }),
    (a) => `Alterou o grupo de acesso "${a.name}": ${a.fields.join(", ")} (+${a.addedPermissions.length} / -${a.removedPermissions.length} permissões).`,
  );
  declare("issue_device", Device, (a) => `Emitiu o certificado do Dispositivo "${a.name}".`);
  declare("revoke_device", Device, (a) => `Revogou o Dispositivo "${a.name}".`);
  declare("delete_device", Device, (a) => `Excluiu o Dispositivo revogado "${a.name}".`);
  declare("login_with_device", z.object({ username: z.string(), deviceName: z.string() }), (a) => `Entrou pelo Dispositivo "${a.deviceName}".`);
  declare(
    "login_without_certificate",
    z.object({ username: z.string(), reason: z.enum(["no_device", "ca_unavailable"]) }),
    (a) => `Entrou sem certificado: "${a.username}"${a.reason === "ca_unavailable" ? " (autoridade certificadora indisponível)" : ""}.`,
  );
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
  declare("lock_session", z.object({ username: z.string() }), (a) => `Bloqueou a sessão de "${a.username}" por inatividade.`);
  declare("unlock_session", z.object({ username: z.string() }), (a) => `Desbloqueou a sessão de "${a.username}" com a senha.`);
  declare(
    "detect_session_reuse",
    z.object({ username: z.string() }),
    (a) => `Detectou o reuso de um token de renovação de "${a.username}" e encerrou a sessão.`,
  );
  declare("logout", z.object({ username: z.string() }), (a) => `Encerrou a sessão de "${a.username}".`);
}
