const FORBIDDEN = /\b(insert|update|delete|merge|drop|alter|create|truncate|exec|execute|grant|revoke|deny|backup|restore|shutdown|into|openrowset|opendatasource|xp_\w+|sp_\w+)\b/i;

/**
 * Garante que a consulta é uma leitura. Camada extra: a proteção principal é o usuário somente leitura do banco.
 */
export function assertReadOnlyQuery(sqlText: string): void {
  const code = sqlText
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .trim();

  if (!/^(select|with)\b/i.test(code)) {
    throw new Error("Somente consultas SELECT/WITH são permitidas nas fontes de dados.");
  }
  if (code.replace(/;\s*$/, "").includes(";")) {
    throw new Error("Múltiplas instruções não são permitidas nas fontes de dados.");
  }
  const forbidden = code.match(FORBIDDEN);
  if (forbidden) {
    throw new Error(`Comando não permitido em fonte somente leitura: ${forbidden[1]!.toUpperCase()}.`);
  }
}
