import { hasPermission } from "./has-permission.js";

const MAX_LISTED = 10;

/** Chaves de `targets` que o chamador não possui ("*" cobre tudo; admin é isento; falha fechado). Usa as permissões do token vigente (até 5 min defasado), sem revalidar no store. */
export function missingGrants(
  callerPermissions: readonly string[] | undefined,
  targets: readonly string[],
  callerIsAdmin: boolean
): string[] {
  if (callerIsAdmin) return [];
  return targets.filter((key) => !hasPermission(callerPermissions, key));
}

/** O chamador só pode conceder o que possui. */
export function canGrant(
  callerPermissions: readonly string[] | undefined,
  targets: readonly string[],
  callerIsAdmin: boolean
): boolean {
  return missingGrants(callerPermissions, targets, callerIsAdmin).length === 0;
}

/** Mensagem do 403 listando no máximo 10 chaves, para não vazar o catálogo. */
export function grantDeniedMessage(missing: readonly string[]): string {
  const shown = missing.slice(0, MAX_LISTED).join(", ");
  const rest = missing.length > MAX_LISTED ? ` e mais ${missing.length - MAX_LISTED}` : "";
  return `Você não pode conceder permissões que não possui: ${shown}${rest}.`;
}
