/**
 * Única checagem de permissão do servidor: honra o curinga "*" e falha fechado
 * (lista ausente, vazia ou que não seja array nega).
 */
export function hasPermission(userPermissions: readonly string[] | undefined, key: string): boolean {
  if (!Array.isArray(userPermissions)) return false;
  return userPermissions.includes("*") || userPermissions.includes(key);
}
